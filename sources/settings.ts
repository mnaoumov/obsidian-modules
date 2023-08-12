import {
	AdvancedSettingTab,
	type AnyObject,
	DOMClasses,
	closeSetting,
	createChildElement,
	createDocumentFragment,
	launderUnchecked,
	linkSetting,
	registerSettingsCommands,
	resetButton,
} from "@polyipseity/obsidian-plugin-library"
import type { ModulesPlugin } from "./main.js"
import { REQUIRE_TAG } from "./require/require.js"
import { Settings } from "./settings-data.js"
import { isObject } from "lodash-es"
import type { loadDocumentations } from "./documentations.js"
import semverLt from "semver/functions/lt.js"

export class SettingTab extends AdvancedSettingTab<Settings> {
	public constructor(
		protected override readonly context: ModulesPlugin,
		protected readonly docs: loadDocumentations.Loaded,
	) { super(context) }

	protected override onLoad(): void {
		super.onLoad()
		const {
			containerEl,
			context: { language: { value: i18n }, settings, version },
			docs,
			ui,
		} = this
		this.newDescriptionWidget()
		this.newLanguageWidget(
			Settings.DEFAULTABLE_LANGUAGES,
			language => language
				? i18n.t(`language:${language}`)
				: i18n.t("settings.language-default"),
			Settings.DEFAULT,
		)
		ui.newSetting(containerEl, setting => {
			setting
				.setName(i18n.t("settings.documentation"))
				.addButton(button => button
					.setIcon(i18n.t("asset:settings.documentations.donate-icon"))
					.setTooltip(i18n.t("settings.documentations.donate"))
					.setCta()
					.onClick(() => { docs.open("donate") }))
				.addButton(button => button
					.setIcon(i18n.t("asset:settings.documentations.readme-icon"))
					.setTooltip(i18n.t("settings.documentations.readme"))
					.setCta()
					.onClick(() => {
						docs.open("readme")
						closeSetting(containerEl)
					}))
				.addButton(button => {
					button
						.setIcon(i18n.t("asset:settings.documentations.changelog-icon"))
						.setTooltip(i18n.t("settings.documentations.changelog"))
						.onClick(() => {
							docs.open("changelog")
							closeSetting(containerEl)
						})
					if (version === null ||
						semverLt(settings.value.lastReadChangelogVersion, version)) {
						button.setCta()
					}
				})
		})
		this.newAllSettingsWidget(
			Settings.DEFAULT,
			Settings.fix,
		)
		ui
			.newSetting(containerEl, setting => {
				const { settingEl } = setting,
					req = launderUnchecked<AnyObject>(self)[settings.value.requireName],
					req2 = isObject(req) ? req : {}
				setting
					.setName(i18n.t("settings.require-name"))
					.setDesc(REQUIRE_TAG in req2
						? ""
						: createDocumentFragment(settingEl.ownerDocument, frag => {
							createChildElement(frag, "span", ele => {
								ele.classList.add(DOMClasses.MOD_WARNING)
								ele.textContent =
									i18n.t("settings.require-name-description-invalid")
							})
						}))
					.addText(linkSetting(
						() => settings.value.requireName,
						async value => settings.mutate(settingsM => {
							settingsM.requireName = value
						}),
						() => { this.postMutate() },
					))
					.addExtraButton(resetButton(
						i18n.t("asset:settings.require-name-icon"),
						i18n.t("settings.reset"),
						async () => settings.mutate(settingsM => {
							settingsM.requireName = Settings.DEFAULT.requireName
						}),
						() => { this.postMutate() },
					))
			})
			.newSetting(containerEl, setting => {
				const { settingEl } = setting
				setting
					.setName(i18n.t("settings.expose-internal-modules"))
					.setDesc(createDocumentFragment(settingEl.ownerDocument, frag => {
						createChildElement(frag, "span", ele => {
							ele.innerHTML = i18n
								.t("settings.expose-internal-modules-description-HTML")
						})
					}))
					.addToggle(linkSetting(
						() => settings.value.exposeInternalModules,
						async value => settings.mutate(settingsM => {
							settingsM.exposeInternalModules = value
						}),
						() => { this.postMutate() },
					))
					.addExtraButton(resetButton(
						i18n.t("asset:settings.expose-internal-modules-icon"),
						i18n.t("settings.reset"),
						async () => settings.mutate(settingsM => {
							settingsM.exposeInternalModules =
								Settings.DEFAULT.exposeInternalModules
						}),
						() => { this.postMutate() },
					))
			})
		this.newSectionWidget(() => i18n.t("settings.interface"))
		ui.newSetting(containerEl, setting => {
			setting
				.setName(i18n.t("settings.open-changelog-on-update"))
				.addToggle(linkSetting(
					() => settings.value.openChangelogOnUpdate,
					async value => settings.mutate(settingsM => {
						settingsM.openChangelogOnUpdate = value
					}),
					() => { this.postMutate() },
				))
				.addExtraButton(resetButton(
					i18n.t("asset:settings.open-changelog-on-update-icon"),
					i18n.t("settings.reset"),
					async () => settings.mutate(settingsM => {
						settingsM.openChangelogOnUpdate =
							Settings.DEFAULT.openChangelogOnUpdate
					}),
					() => { this.postMutate() },
				))
		})
		this.newNoticeTimeoutWidget(Settings.DEFAULT)
	}

	protected override snapshot0(): Partial<Settings> {
		return Settings.persistent(this.context.settings.value)
	}
}

export function loadSettings(
	context: ModulesPlugin,
	docs: loadDocumentations.Loaded,
): void {
	context.addSettingTab(new SettingTab(context, docs))
	registerSettingsCommands(context)
}
