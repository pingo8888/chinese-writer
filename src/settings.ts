import { App, PluginSettingTab, Setting } from "obsidian";
import type ChineseWriterPlugin from "./main";

/**
 * 文件夹对应关系
 */
export interface FolderMapping {
  /** 唯一ID */
  id: string;
  /** 小说库路径 */
  novelFolder: string;
  /** 设定库路径 */
  settingFolder: string;
}

/**
 * 高亮模式
 */
export type HighlightMode = "first" | "all";

/**
 * 高亮样式配置
 */
export interface HighlightStyle {
  /** 高亮模式 (first: 首次高亮, all: 全部高亮) */
  mode: HighlightMode;
  /** 背景色 */
  backgroundColor: string;
  /** 下划线样式 (solid, dashed, dotted, double, wavy) */
  borderStyle: string;
  /** 边框粗细 (px) */
  borderWidth: number;
  /** 边框颜色 */
  borderColor: string;
  /** 字体粗细 (normal, bold) */
  fontWeight: string;
  /** 字体样式 (normal, italic) */
  fontStyle: string;
  /** 文字颜色 */
  color: string;
}

/**
 * 高亮预览栏配置
 */
export interface HighlightPreviewStyle {
  /** 预览栏宽度（px） */
  width: number;
  /** 预览栏最大高度（px） */
  height: number;
  /** 下方内容最多显示行数（超出出现滚动条） */
  maxBodyLines: number;
}

/**
 * 常见标点检测配置
 */
export interface PunctuationCheckSettings {
  /** 总开关 */
  enabled: boolean;
  /** 英文逗号 , */
  comma: boolean;
  /** 英文句号 . */
  period: boolean;
  /** 英文冒号 : */
  colon: boolean;
  /** 英文分号 ; */
  semicolon: boolean;
  /** 英文感叹号 ! */
  exclamation: boolean;
  /** 英文问号 ? */
  question: boolean;
  /** 英文双引号 " 及中文双引号配对 */
  doubleQuote: boolean;
  /** 英文单引号 ' 及中文单引号配对 */
  singleQuote: boolean;
}

/**
 * 插件设置接口
 */
export interface ChineseWriterSettings {
  /** 文件夹对应关系列表 */
  folderMappings: FolderMapping[];
  /** 高亮样式配置 */
  highlightStyle: HighlightStyle;
  /** 高亮预览栏配置 */
  highlightPreviewStyle: HighlightPreviewStyle;
  /** 常见标点检测配置 */
  punctuationCheck: PunctuationCheckSettings;
  /** 编辑区行首缩进（中文字符数） */
  editorIndentCjkChars: number;
  /** 编辑区行间距 */
  editorLineHeight: number;
  /** 编辑区段间距（px） */
  editorParagraphSpacing: number;
  /** 是否启用编辑区排版 */
  enableEditorTypography: boolean;
  /** 是否启用正文高亮悬停预览 */
  enableEditorHoverPreview: boolean;
  /** 是否启用右边栏第3层节点悬停预览 */
  enableTreeH2HoverPreview: boolean;
  /** 通过插件功能打开/新建文件时是否在新标签页打开 */
  openInNewTab: boolean;
  /** 是否启用字符数统计功能 */
  enableMdStats: boolean;
  /** 是否在编辑区标题前显示等级图标 */
  enableEditorHeadingIcons: boolean;
}

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: ChineseWriterSettings = {
  folderMappings: [],
  highlightStyle: {
    mode: "all",
    backgroundColor: "#FFFFFF00",
    borderStyle: "dotted",
    borderWidth: 2,
    borderColor: "#4A86E9",
    fontWeight: "normal",
    fontStyle: "normal",
    color: "#4A86E9"
  },
  highlightPreviewStyle: {
    width: 300,
    height: 340,
    maxBodyLines: 12,
  },
  punctuationCheck: {
    enabled: false,
    comma: true,
    period: true,
    colon: true,
    semicolon: true,
    exclamation: true,
    question: true,
    doubleQuote: true,
    singleQuote: true,
  },
  editorIndentCjkChars: 2,
  editorLineHeight: 1.6,
  editorParagraphSpacing: 12,
  enableEditorTypography: false,
  enableEditorHoverPreview: true,
  enableTreeH2HoverPreview: false,
  openInNewTab: true,
  enableMdStats: false,
  enableEditorHeadingIcons: false,
};

/**
 * 设置面板
 */
export class ChineseWriterSettingTab extends PluginSettingTab {
  plugin: ChineseWriterPlugin;
  private isAddingMapping = false;

  constructor(app: App, plugin: ChineseWriterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const saveAndRefreshPunctuation = async () => {
      await this.plugin.saveSettings();
      this.refreshEditorHighlight();
    };
    const punctuationOptionToggles: Array<{ setDisabled: (disabled: boolean) => unknown }> = [];
    const setPunctuationOptionDisabled = (disabled: boolean) => {
      for (const toggle of punctuationOptionToggles) {
        toggle.setDisabled(disabled);
      }
    };

    containerEl.empty();

    containerEl.createEl("h2", { text: "中文写作插件设置", cls: "cw-settings-main-title" });

    // 文件夹对应关系设置
    containerEl.createEl("h3", { text: "文件夹对应关系" });
    containerEl.createEl("p", {
      text: "配置小说库和设定库的对应关系。在小说库文件打开时，会显示对应设定库的内容，并高亮关键字。",
      cls: "setting-item-description"
    });

    // 显示现有的对应关系
    const mappingsContainer = containerEl.createDiv({ cls: "folder-mappings-container" });
    this.renderMappings(mappingsContainer);

    // 添加新对应关系按钮
    new Setting(containerEl)
      .setName("添加新对应关系")
      .addButton((button) =>
        button
          .setButtonText("添加")
          .setCta()
          .onClick(() => {
            if (this.isAddingMapping) {
              return; // 防止重复点击
            }
            this.addNewMapping();
          })
      );

    // 高亮样式设置
    containerEl.createEl("h3", { text: "关键字高亮样式" });

    new Setting(containerEl)
      .setName("高亮模式")
      .setDesc("选择关键字的高亮方式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("first", "首次高亮")
          .addOption("all", "全部高亮")
          .setValue(this.plugin.settings.highlightStyle.mode)
          .onChange(async (value: HighlightMode) => {
            this.plugin.settings.highlightStyle.mode = value;
            await this.plugin.saveSettings();
            this.refreshEditorHighlight();
          })
      );

    new Setting(containerEl)
      .setName("背景色")
      .setDesc("高亮关键字的背景颜色（支持8位HEX，如 #FFFFFF00，最后两位为透明度）")
      .addText((text) =>
        text
          .setPlaceholder("#FFFFFF00")
          .setValue(this.plugin.settings.highlightStyle.backgroundColor)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.backgroundColor = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(containerEl)
      .setName("下划线样式")
      .setDesc("高亮关键字的下划线样式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("solid", "实线")
          .addOption("dashed", "虚线")
          .addOption("dotted", "点线")
          .addOption("double", "双线")
          .addOption("wavy", "波浪线")
          .setValue(this.plugin.settings.highlightStyle.borderStyle)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.borderStyle = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(containerEl)
      .setName("下划线粗细")
      .setDesc("高亮关键字的下划线粗细（0-10像素）")
      .addSlider((slider) =>
        slider
          .setLimits(0, 10, 1)
          .setValue(this.plugin.settings.highlightStyle.borderWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.borderWidth = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(containerEl)
      .setName("下划线颜色")
      .setDesc("高亮关键字的下划线颜色")
      .addText((text) =>
        text
          .setPlaceholder("#4A86E9")
          .setValue(this.plugin.settings.highlightStyle.borderColor)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.borderColor = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(containerEl)
      .setName("字体粗细")
      .setDesc("高亮关键字的字体粗细")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("normal", "正常")
          .addOption("bold", "粗体")
          .setValue(this.plugin.settings.highlightStyle.fontWeight)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.fontWeight = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(containerEl)
      .setName("字体样式")
      .setDesc("高亮关键字的字体样式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("normal", "正常")
          .addOption("italic", "斜体")
          .setValue(this.plugin.settings.highlightStyle.fontStyle)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.fontStyle = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(containerEl)
      .setName("文字颜色")
      .setDesc("高亮关键字的文字颜色（支持8位HEX，如 #4A86E9ff，inherit表示继承原有颜色）")
      .addText((text) =>
        text
          .setPlaceholder("#4A86E9")
          .setValue(this.plugin.settings.highlightStyle.color)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.color = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    // 常见标点检测设置
    containerEl.createEl("h3", { text: "常见标点检测" });

    new Setting(containerEl)
      .setName("启用常见标点检测")
      .setDesc("仅在已配置小说库中的 Markdown 文件内进行检测")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.enabled = value;
            await saveAndRefreshPunctuation();
            setPunctuationOptionDisabled(!value);
          })
      );

    new Setting(containerEl)
      .setName("检测英文逗号（,）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.comma)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.comma = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(containerEl)
      .setName("检测英文句号（.）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.period)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.period = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(containerEl)
      .setName("检测英文冒号（:）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.colon)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.colon = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(containerEl)
      .setName("检测英文分号（;）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.semicolon)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.semicolon = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(containerEl)
      .setName("检测英文感叹号（!）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.exclamation)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.exclamation = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(containerEl)
      .setName("检测英文问号（?）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.question)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.question = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(containerEl)
      .setName("检测双引号")
      .setDesc("检测英文双引号（\"）与中文双引号（“”）配对错误")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.doubleQuote)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.doubleQuote = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(containerEl)
      .setName("检测单引号")
      .setDesc("检测英文单引号（'）与中文单引号（‘’）配对错误")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.singleQuote)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.singleQuote = value;
            await saveAndRefreshPunctuation();
          });
      });

    // 高亮预览栏设置
    containerEl.createEl("h3", { text: "预览栏设置" });

    new Setting(containerEl)
      .setName("正文悬停预览")
      .setDesc("开启后，鼠标悬停正文高亮关键词时显示预览栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEditorHoverPreview)
          .onChange(async (value) => {
            this.plugin.settings.enableEditorHoverPreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("右边栏悬停预览")
      .setDesc("开启后，鼠标悬停右边栏时显示预览栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTreeH2HoverPreview)
          .onChange(async (value) => {
            this.plugin.settings.enableTreeH2HoverPreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("预览栏宽度")
      .setDesc("悬停预览栏宽度（像素）")
      .addSlider((slider) =>
        slider
          .setLimits(240, 720, 20)
          .setValue(this.plugin.settings.highlightPreviewStyle.width)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.highlightPreviewStyle.width = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("预览栏高度")
      .setDesc("悬停预览栏最大高度（像素）")
      .addSlider((slider) =>
        slider
          .setLimits(160, 800, 20)
          .setValue(this.plugin.settings.highlightPreviewStyle.height)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.highlightPreviewStyle.height = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("下方内容最多显示行数")
      .setDesc("超过该行数时显示滚动条")
      .addSlider((slider) =>
        slider
          .setLimits(3, 50, 1)
          .setValue(this.plugin.settings.highlightPreviewStyle.maxBodyLines)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.highlightPreviewStyle.maxBodyLines = value;
            await this.plugin.saveSettings();
          })
      );

    // 文件打开行为设置
    containerEl.createEl("h3", { text: "文件打开行为" });

    new Setting(containerEl)
      .setName("在新标签页打开")
      .setDesc("通过插件内相关功能打开或新建文件时，是否在新标签页打开（已打开则复用现有标签）")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openInNewTab)
          .onChange(async (value) => {
            this.plugin.settings.openInNewTab = value;
            await this.plugin.saveSettings();
          })
      );

    // 编辑区排版设置
    containerEl.createEl("h3", { text: "编辑区排版" });

    new Setting(containerEl)
      .setName("启用编辑区排版")
      .setDesc("关闭后不应用行首缩进、行间距和段间距")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEditorTypography)
          .onChange(async (value) => {
            this.plugin.settings.enableEditorTypography = value;
            await this.plugin.saveSettings();
            this.updateEditorTypographyStyles();
          })
      );

    new Setting(containerEl)
      .setName("行首缩进（中文字符）")
      .setDesc("仅编辑视图生效，按中文字符宽度缩进")
      .addSlider((slider) =>
        slider
          .setLimits(0, 6, 0.5)
          .setValue(this.plugin.settings.editorIndentCjkChars)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.editorIndentCjkChars = value;
            await this.plugin.saveSettings();
            this.updateEditorTypographyStyles();
          })
      );

    new Setting(containerEl)
      .setName("行间距")
      .setDesc("仅编辑视图生效")
      .addSlider((slider) =>
        slider
          .setLimits(1.2, 2.6, 0.1)
          .setValue(this.plugin.settings.editorLineHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.editorLineHeight = value;
            await this.plugin.saveSettings();
            this.updateEditorTypographyStyles();
          })
      );

    new Setting(containerEl)
      .setName("段间距")
      .setDesc("仅编辑视图生效；与行间距独立，不叠加")
      .addSlider((slider) =>
        slider
          .setLimits(0, 32, 1)
          .setValue(this.plugin.settings.editorParagraphSpacing)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.editorParagraphSpacing = value;
            await this.plugin.saveSettings();
            this.updateEditorTypographyStyles();
          })
      );

    // 其他便捷功能
    containerEl.createEl("h3", { text: "其他便捷功能" });

    new Setting(containerEl)
      .setName("启用字符数统计")
      .setDesc("关闭后不显示统计，且不在后台执行字符统计")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableMdStats)
          .onChange(async (value) => {
            this.plugin.settings.enableMdStats = value;
            await this.plugin.saveSettings();
            this.plugin.mdStatsManager.setEnabled(value);
          })
      );

    new Setting(containerEl)
      .setName("编辑区标题图标")
      .setDesc("在编辑视图各级标题前显示对应等级图标")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEditorHeadingIcons)
          .onChange(async (value) => {
            this.plugin.settings.enableEditorHeadingIcons = value;
            await this.plugin.saveSettings();
            this.plugin.mdStatsManager.refreshEditorDecorations();
          })
      );
  }

  /**
   * 渲染文件夹对应关系列表
   */
  private renderMappings(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.folderMappings.length === 0) {
      container.createEl("p", {
        text: "暂无对应关系，请点击下方按钮添加。",
        cls: "setting-item-description"
      });
      return;
    }

    this.plugin.settings.folderMappings.forEach((mapping, index) => {
      const displayText = `${mapping.novelFolder || "未设置"} → ${mapping.settingFolder || "未设置"}`;

      new Setting(container)
        .setName(displayText)
        .setClass("folder-mapping-item")
        .addButton((button) =>
          button
            .setButtonText("编辑")
            .onClick(async () => {
              await this.editMapping(mapping);
            })
        )
        .addButton((button) =>
          button
            .setButtonText("删除")
            .setWarning()
            .onClick(async () => {
              if (mapping.settingFolder) {
                await this.plugin.orderManager.removeFolderData(mapping.settingFolder);
              }
              this.plugin.settings.folderMappings =
                this.plugin.settings.folderMappings.filter(m => m.id !== mapping.id);
              await this.plugin.saveSettings();
              await this.plugin.refreshView();
              this.refreshEditorHighlight();
              this.display();
            })
        );
    });
  }

  /**
   * 编辑现有的对应关系
   */
  private async editMapping(mapping: FolderMapping): Promise<void> {
    const { TextInputModal } = await import("./modals");
    const oldSettingFolder = mapping.settingFolder;

    // 第一次弹出：编辑小说库路径
    new TextInputModal(
      this.app,
      "编辑对应关系 - 步骤 1/2",
      "请输入小说库路径（相对于仓库根目录）",
      mapping.novelFolder,
      async (novelFolder) => {
        if (!novelFolder.trim()) {
          return;
        }

        // 延迟打开第二个弹出框，确保第一个弹出框完全关闭
        setTimeout(() => {
          // 第二次弹出：编辑设定库路径
          new TextInputModal(
            this.app,
            "编辑对应关系 - 步骤 2/2",
            "请输入设定库路径（相对于仓库根目录）",
            mapping.settingFolder,
            async (settingFolder) => {
              if (!settingFolder.trim()) {
                return;
              }

              // 更新对应关系
              mapping.novelFolder = novelFolder.trim();
              mapping.settingFolder = settingFolder.trim();

              if (oldSettingFolder) {
                await this.plugin.orderManager.removeFolderData(oldSettingFolder);
              }
              await this.plugin.saveSettings();

              // 延迟刷新界面和编辑器，确保弹出框完全关闭
              setTimeout(async () => {
                await this.plugin.refreshView();
                this.refreshEditorHighlight();
                this.display();
              }, 50);
            }
          ).open();
        }, 100);
      }
    ).open();
  }

  /**
   * 添加新的对应关系（使用两次弹出输入框）
   */
  private async addNewMapping(): Promise<void> {
    if (this.isAddingMapping) {
      return; // 防止重复调用
    }

    this.isAddingMapping = true;
    const { TextInputModal } = await import("./modals");

    // 第一次弹出：输入小说库路径
    new TextInputModal(
      this.app,
      "添加对应关系 - 步骤 1/2",
      "请输入小说库路径（相对于仓库根目录）",
      "",
      async (novelFolder) => {
        if (!novelFolder.trim()) {
          this.isAddingMapping = false;
          return;
        }

        // 延迟打开第二个弹出框，确保第一个弹出框完全关闭
        setTimeout(() => {
          // 第二次弹出：输入设定库路径
          new TextInputModal(
            this.app,
            "添加对应关系 - 步骤 2/2",
            "请输入设定库路径（相对于仓库根目录）",
            "",
            async (settingFolder) => {
              if (!settingFolder.trim()) {
                this.isAddingMapping = false;
                return;
              }

              // 创建新的对应关系
              const newMapping: FolderMapping = {
                id: Date.now().toString(),
                novelFolder: novelFolder.trim(),
                settingFolder: settingFolder.trim()
              };

              this.plugin.settings.folderMappings.push(newMapping);
              await this.plugin.saveSettings();

              // 延迟刷新界面和编辑器，确保弹出框完全关闭
              setTimeout(async () => {
                await this.plugin.refreshView();
                this.refreshEditorHighlight();
                this.display();
                this.isAddingMapping = false; // 完成后重置标志
              }, 50);
            }
          ).open();
        }, 100);
      }
    ).open();
  }

  /**
   * 更新高亮样式
   */
  private updateHighlightStyles(): void {
    // 触发编辑器更新高亮样式
    if (this.plugin.highlightManager) {
      this.plugin.highlightManager.updateStyles();
    }
  }

  /**
   * 刷新编辑器高亮
   */
  private refreshEditorHighlight(): void {
    // 清除关键字缓存并强制刷新编辑器
    if (this.plugin.highlightManager) {
      this.plugin.highlightManager.refreshCurrentEditor();
    }
  }

  private updateEditorTypographyStyles(): void {
    if (this.plugin.editorTypographyManager) {
      this.plugin.editorTypographyManager.updateStyles();
    }
  }
}
