import { App, PluginSettingTab, Setting } from "obsidian";
import type ChineseWriterPlugin from "./main";

/**
 * 插件设置接口
 */
export interface ChineseWriterSettings {
  /** 要读取的目录路径 */
  targetFolder: string;
}

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: ChineseWriterSettings = {
  targetFolder: "",
};

/**
 * 设置面板
 */
export class ChineseWriterSettingTab extends PluginSettingTab {
  plugin: ChineseWriterPlugin;

  constructor(app: App, plugin: ChineseWriterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("目标文件夹")
      .setDesc("指定要读取 Markdown 文件的文件夹路径（相对于仓库根目录）")
      .addText((text) =>
        text
          .setPlaceholder("例如: 小说/第一部")
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (value) => {
            this.plugin.settings.targetFolder = value;
            await this.plugin.saveSettings();
            // 刷新视图
            this.plugin.refreshView();
          })
      );
  }
}
