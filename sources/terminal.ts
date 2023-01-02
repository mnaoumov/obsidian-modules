import {
	ItemView,
	type ViewStateResult,
	type WorkspaceLeaf,
	debounce,
} from "obsidian"
import { NOTICE_NO_TIMEOUT, TERMINAL_EXIT_SUCCESS, TERMINAL_RESIZE_TIMEOUT } from "./magic"
import { type TerminalPty, WindowsTerminalPty } from "./pty"
import { type TerminalSerial, TerminalSerializer } from "./terminal-serialize"
import { UnnamespacedID, inSet, isInterface, notice, onVisible, openExternal, printError, statusBar, updateDisplayText } from "./util"
import { basename, extname } from "path"
import { FitAddon } from "xterm-addon-fit"
import { SearchAddon } from "xterm-addon-search"
import { Terminal } from "xterm"
import type { TerminalPlugin } from "./main"
import { WebLinksAddon } from "xterm-addon-web-links"

export class TerminalView extends ItemView {
	public static readonly viewType = new UnnamespacedID("terminal-view")
	public static namespacedViewType: string
	#state: TerminalView.State = {
		__type: TerminalView.State.TYPE,
		args: [],
		cwd: "",
		executable: "",
	}

	readonly #terminal = new Terminal({
		allowProposedApi: true,
	})

	readonly #terminalAddons = {
		fit: new FitAddon(),
		search: new SearchAddon(),
		webLinks: new WebLinksAddon((_0, uri) => openExternal(uri)),
	} as const

	#pty?: TerminalPty
	readonly #resizeNative = debounce(
		async (
			columns: number,
			rows: number,
		) => {
			try {
				await this.#pty?.resize(columns, rows)
				this.#serializer.resize(columns, rows)
				this.plugin.app.workspace.requestSaveLayout()
			} catch (error) { void error }
		},
		TERMINAL_RESIZE_TIMEOUT,
		false,
	)

	readonly #serializer = new TerminalSerializer()

	public constructor(
		protected readonly plugin: TerminalPlugin,
		leaf: WorkspaceLeaf,
	) {
		super(leaf)
		for (const addon of Object.values(this.#terminalAddons)) {
			this.#terminal.loadAddon(addon)
		}
	}

	public override async setState(
		state: any,
		result: ViewStateResult,
	): Promise<void> {
		await super.setState(state, result)
		if (!isInterface<TerminalView.State>(TerminalView.State.TYPE, state) || typeof this.#pty !== "undefined") {
			return
		}
		this.#state = state

		const { plugin } = this,
			{ i18n } = plugin,
			pty = new plugin.platform.terminalPty(
				plugin,
				state.executable,
				state.cwd,
				state.args,
			)
		this.register(() => pty.shell.kill())
		this.#pty = pty
		const { shell } = pty.once("exit", code => {
			this.leaf.detach()
			notice(
				() => i18n.t("notices.terminal-exited", { code }),
				inSet(TERMINAL_EXIT_SUCCESS, code)
					? plugin.settings.noticeTimeout
					: NOTICE_NO_TIMEOUT,
				plugin,
			)
		})
		shell.once("error", error => {
			printError(error, () => i18n.t("errors.error-spawning-terminal"), plugin)
		})

		const { serial } = state
		const enum StdoutState {
			conhost = 1,
			clear = 2,
		}
		let stdoutState: StdoutState =
			(pty instanceof WindowsTerminalPty ? 0 : StdoutState.conhost) |
			StdoutState.clear
		if (typeof serial !== "undefined") {
			stdoutState &= ~StdoutState.clear
			this.#serializer.unserialize(serial)
			this.#terminal.resize(serial.columns, serial.rows)
			this.#terminal.write(serial.data)
		}
		shell.stdout.on("data", (chunk: Buffer | string) => {
			if ((stdoutState & StdoutState.conhost) === 0) {
				stdoutState |= StdoutState.conhost
				// Skip conhost.exe output
				return
			}
			if ((stdoutState & StdoutState.clear) === 0) {
				stdoutState |= StdoutState.clear
				// Clear screen with scrollback kept
				this.#write("\n\u001b[K".repeat(this.#terminal.rows))
				this.#write("\u001b[H")
			}
			this.#write(chunk)
		})
		shell.stderr.on("data", (chunk: Buffer | string) => { this.#terminal.write(chunk) })
		this.#terminal.onData(data => shell.stdin.write(data))
	}

	public override getState(): any {
		this.#state.serial = this.#serializer.serialize()
		return Object.assign(super.getState(), this.#state)
	}

	public override onResize(): void {
		super.onResize()
		if (this.plugin.app.workspace.getActiveViewOfType(TerminalView) === this) {
			const { fit } = this.#terminalAddons,
				dim = fit.proposeDimensions()
			if (typeof dim === "undefined") {
				return
			}
			fit.fit()
			this.#resizeNative(dim.cols, dim.rows)
		}
	}

	public getDisplayText(): string {
		const { executable } = this.#state
		return this.plugin.i18n.t("views.terminal-view.display-name", { executable: basename(executable, extname(executable)) })
	}

	public override getIcon(): string {
		return this.plugin.i18n.t("asset:views.terminal-view-icon")
	}

	public getViewType(): string {
		// Workaround: super() calls this method
		return TerminalView.namespacedViewType
	}

	protected override async onOpen(): Promise<void> {
		await super.onOpen()
		const { containerEl, plugin } = this

		containerEl.empty()
		containerEl.createDiv({}, ele => {
			const obsr = onVisible(ele, obsr0 => {
				try {
					this.register(() => { this.#terminal.dispose() })
					this.#terminal.open(ele)
				} finally {
					obsr0.disconnect()
				}
			})
			this.register(() => { obsr.disconnect() })
		})

		this.registerEvent(plugin.app.workspace.on("active-leaf-change", leaf => {
			if (leaf === this.leaf) {
				this.#terminal.focus()
				return
			}
			this.#terminal.blur()
		}))
		statusBar(div => {
			const hider = new MutationObserver(() => void (div.style.visibility = "hidden"))
			this.register(() => {
				hider.disconnect()
				div.style.visibility = ""
			})
			this.registerEvent(plugin.app.workspace.on("active-leaf-change", leaf => {
				hider.disconnect()
				if (leaf === this.leaf) {
					div.style.visibility = "hidden"
					hider.observe(div, { attributeFilter: ["style"] })
					return
				}
				div.style.visibility = ""
			}))
		})
		this.register(this.plugin.language.registerUse(() =>
			updateDisplayText(this)))
	}

	#write(data: Buffer | string): void {
		this.#serializer.write(data)
		this.#terminal.write(data)
		this.plugin.app.workspace.requestSaveLayout()
	}
}
export namespace TerminalView {
	export interface State {
		readonly __type: typeof State.TYPE
		readonly executable: string
		readonly cwd: string
		readonly args: string[]
		serial?: TerminalSerial
	}
	export namespace State {
		export const TYPE = "8d54e44a-32e7-4297-8ae2-cff88e92ce28"
	}
}
