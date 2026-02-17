import { App, TFile, MarkdownView, editorLivePreviewField, setIcon } from "obsidian";
import type ChineseWriterPlugin from "./main";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, PluginValue } from "@codemirror/view";
import { RangeSetBuilder, Transaction } from "@codemirror/state";

interface KeywordPreviewData {
  keyword: string;
  filePath: string;
  fileName: string;
  h1Title: string;
  h2Title: string;
  aliases: string[];
  bodyLines: string[];
}

interface H3SectionData {
  title: string;
  aliases: string[];
  bodyLines: string[];
}

/**
 * 高亮管理器
 * 负责在编辑器中高亮显示设定库中的关键字
 */
export class HighlightManager {
  plugin: ChineseWriterPlugin;
  app: App;
  private keywordsCache: Map<string, Set<string>> = new Map();
  private keywordPreviewCache: Map<string, Map<string, KeywordPreviewData>> = new Map();
  private keywordGroupCache: Map<string, Map<string, string>> = new Map();
  private keywordsVersion = 0;
  private previewEl: HTMLElement | null = null;
  private previewHoverKey = "";
  private previewAnchorEl: HTMLElement | null = null;
  private currentPreviewData: KeywordPreviewData | null = null;
  private previewHideTimer: number | null = null;
  private readonly previewHideDelayMs = 450;

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.initializeHoverPreview();
    this.plugin.register(() => this.destroyHoverPreview());
  }

  /**
   * 获取当前文件对应的设定库路径
   */
  getSettingFolderForFile(filePath: string): string | null {
    // 检查文件是否在某个小说库中
    for (const mapping of this.plugin.settings.folderMappings) {
      if (mapping.novelFolder && mapping.settingFolder) {
        // 标准化路径，确保没有前导/后缀斜杠
        const normalizedNovelFolder = mapping.novelFolder.replace(/^\/+|\/+$/g, '');
        const normalizedFilePath = filePath.replace(/^\/+/, '');

        if (normalizedFilePath.startsWith(normalizedNovelFolder + "/")) {
          return mapping.settingFolder;
        }
      }
    }

    return null;
  }

  /**
   * 从设定库中提取所有H2标题（关键字）
   */
  async extractKeywordsFromSettingFolder(settingFolder: string): Promise<Set<string>> {
    // 检查缓存
    if (
      this.keywordsCache.has(settingFolder) &&
      this.keywordPreviewCache.has(settingFolder) &&
      this.keywordGroupCache.has(settingFolder)
    ) {
      return this.keywordsCache.get(settingFolder)!;
    }

    const keywords = new Set<string>();
    const previewMap = new Map<string, KeywordPreviewData>();
    const groupMap = new Map<string, string>();

    if (!settingFolder) {
      return keywords;
    }

    // 获取设定库中的所有文件
    const files = this.plugin.parser.getMarkdownFilesInFolder(settingFolder);

    // 解析每个文件，提取H2标题
    for (const file of files) {
      const parseResult = await this.plugin.parser.parseFile(file);
      if (parseResult) {
        // 遍历所有H1
        for (const h1 of parseResult.h1List) {
          // 遍历所有H2
          for (const h2 of h1.h2List) {
            // H2的文本就是关键字
            const keyword = h2.text.trim();
            if (keyword) {
              const h2Aliases = this.extractAliases(h2.content);
              const h2GroupId = `h2::${parseResult.filePath}::${h1.text}::${h2.text}`;
              const h2PreviewData: KeywordPreviewData = {
                keyword,
                filePath: parseResult.filePath,
                fileName: parseResult.fileName,
                h1Title: h1.text,
                h2Title: h2.text,
                aliases: h2Aliases,
                bodyLines: this.extractBodyLines(h2.content),
              };

              this.addKeywordVariant(keywords, previewMap, groupMap, keyword, h2PreviewData, h2GroupId);
              for (const alias of h2Aliases) {
                this.addKeywordVariant(keywords, previewMap, groupMap, alias, h2PreviewData, h2GroupId);
              }

              const h3Sections = this.extractH3Sections(h2.content);
              for (const h3 of h3Sections) {
                if (!h3.title) continue;
                const h3GroupId = `h3::${parseResult.filePath}::${h1.text}::${h2.text}::${h3.title}`;
                const h3PreviewData: KeywordPreviewData = {
                  keyword: h3.title,
                  filePath: parseResult.filePath,
                  fileName: parseResult.fileName,
                  h1Title: h1.text,
                  h2Title: h2.text,
                  aliases: h3.aliases,
                  bodyLines: h3.bodyLines,
                };
                this.addKeywordVariant(keywords, previewMap, groupMap, h3.title, h3PreviewData, h3GroupId);
                for (const alias of h3.aliases) {
                  this.addKeywordVariant(keywords, previewMap, groupMap, alias, h3PreviewData, h3GroupId);
                }
              }
            }
          }
        }
      }
    }

    // 缓存结果
    this.keywordsCache.set(settingFolder, keywords);
    this.keywordPreviewCache.set(settingFolder, previewMap);
    this.keywordGroupCache.set(settingFolder, groupMap);

    return keywords;
  }

  /**
   * 清除关键字缓存
   */
  clearCache(): void {
    this.keywordsCache.clear();
    this.keywordPreviewCache.clear();
    this.keywordGroupCache.clear();
    this.keywordsVersion++;
  }

  /**
   * 获取关键字版本号（缓存失效时递增）
   */
  getKeywordsVersion(): number {
    return this.keywordsVersion;
  }

  /**
   * 强制刷新当前编辑器的高亮
   */
  refreshCurrentEditor(): void {
    // 清除缓存
    this.clearCache();

    // 刷新所有 Markdown 编辑器，避免依赖当前激活叶子
    // 同时派发一次无副作用事务，确保 ViewPlugin 立即执行 update()
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.editor) {
        view.editor.refresh();
        const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
        if (cmView) {
          cmView.dispatch({
            annotations: Transaction.addToHistory.of(false),
          });
        }
      }
    }
  }

  /**
   * 从 CodeMirror EditorView 找到对应的 MarkdownView
   */
  private getMarkdownViewForEditorView(editorView: EditorView): MarkdownView | null {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;

      const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
      if (cmView === editorView) {
        return view;
      }
    }

    return null;
  }

  private extractAliases(lines: string[]): string[] {
    const aliases: string[] = [];

    for (const line of lines) {
      const aliasTag = "【别名】";
      const aliasIndex = line.indexOf(aliasTag);
      if (aliasIndex === -1) continue;

      const rawValue = line.slice(aliasIndex + aliasTag.length).trim();
      if (!rawValue) continue;

      const parts = rawValue.split(/[，,]/);
      for (const part of parts) {
        const alias = part.trim();
        if (alias) {
          aliases.push(alias);
        }
      }
    }

    return [...new Set(aliases)];
  }

  private extractBodyLines(lines: string[]): string[] {
    return lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !/【[^】]+】/.test(line))
      .map((line) => line.replace(/^[-*+]\s+/, "").trim())
      .filter((line) => line.length > 0);
  }

  private getKeywordPreview(settingFolder: string, keyword: string): KeywordPreviewData | null {
    const folderMap = this.keywordPreviewCache.get(settingFolder);
    if (!folderMap) return null;
    return folderMap.get(keyword) ?? null;
  }

  private getKeywordGroupMap(settingFolder: string): Map<string, string> {
    return this.keywordGroupCache.get(settingFolder) ?? new Map();
  }

  private addKeywordVariant(
    keywords: Set<string>,
    previewMap: Map<string, KeywordPreviewData>,
    groupMap: Map<string, string>,
    variant: string,
    previewData: KeywordPreviewData,
    groupId: string
  ): void {
    const normalized = variant.trim();
    if (!normalized) return;
    if (previewMap.has(normalized)) return;
    keywords.add(normalized);
    previewMap.set(normalized, previewData);
    groupMap.set(normalized, groupId);
  }

  private extractH3Sections(lines: string[]): H3SectionData[] {
    const sections: H3SectionData[] = [];
    let currentTitle = "";
    let currentLines: string[] = [];

    const flush = () => {
      if (!currentTitle) return;
      sections.push({
        title: currentTitle,
        aliases: this.extractAliases(currentLines),
        bodyLines: this.extractBodyLines(currentLines),
      });
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("### ") && !trimmed.startsWith("#### ")) {
        flush();
        currentTitle = trimmed.slice(4).trim();
        currentLines = [];
        continue;
      }
      if (currentTitle) {
        currentLines.push(line);
      }
    }

    flush();
    return sections;
  }

  private initializeHoverPreview(): void {
    this.previewEl = document.createElement("div");
    this.previewEl.className = "chinese-writer-highlight-preview";
    this.previewEl.style.display = "none";
    document.body.appendChild(this.previewEl);

    this.plugin.registerDomEvent(this.previewEl, "mouseenter", () => {
      this.clearScheduledHidePreview();
    });
    this.plugin.registerDomEvent(this.previewEl, "mouseleave", () => {
      this.scheduleHidePreview();
    });

    this.plugin.registerDomEvent(document, "mousemove", (event: MouseEvent) => {
      this.handlePreviewHover(event);
    });
    this.plugin.registerDomEvent(document, "mousedown", (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        this.hidePreview();
        return;
      }
      const inPreview = this.previewEl?.contains(target) ?? false;
      const inHighlight = !!target.closest(".chinese-writer-highlight");
      if (!inPreview && !inHighlight) {
        this.hidePreview();
      }
    });
    this.plugin.registerDomEvent(document, "mouseleave", () => this.scheduleHidePreview(120));
  }

  private destroyHoverPreview(): void {
    this.clearScheduledHidePreview();
    if (this.previewEl) {
      this.previewEl.remove();
      this.previewEl = null;
    }
  }

  private handlePreviewHover(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      this.scheduleHidePreview();
      return;
    }

    const inPreview = this.previewEl?.contains(target) ?? false;
    if (inPreview) {
      this.clearScheduledHidePreview();
      return;
    }

    const highlightEl = target.closest(".chinese-writer-highlight") as HTMLElement | null;
    if (!highlightEl) {
      this.scheduleHidePreview();
      return;
    }

    const keyword = highlightEl.dataset.cwKeyword;
    const settingFolder = highlightEl.dataset.cwSettingFolder;
    if (!keyword || !settingFolder) {
      this.scheduleHidePreview();
      return;
    }

    const previewData = this.getKeywordPreview(settingFolder, keyword);
    if (!previewData) {
      this.scheduleHidePreview();
      return;
    }

    this.clearScheduledHidePreview();
    const hoverKey = `${settingFolder}::${keyword}`;
    this.showPreview(previewData, hoverKey, highlightEl, event.clientX, event.clientY);
  }

  private showPreview(
    previewData: KeywordPreviewData,
    hoverKey: string,
    anchorEl: HTMLElement,
    mouseX: number,
    mouseY: number
  ): void {
    if (!this.previewEl) return;
    const isNewHover = this.previewHoverKey !== hoverKey;
    const isNewAnchor = this.previewAnchorEl !== anchorEl;

    if (isNewHover) {
      this.previewEl.empty();

      const headerEl = this.previewEl.createDiv({ cls: "cw-preview-header" });
      const titleWrapEl = headerEl.createDiv({ cls: "cw-preview-header-main" });
      const titleEl = titleWrapEl.createDiv({ cls: "cw-preview-title" });
      titleEl.setText(previewData.keyword);

      const locationEl = titleWrapEl.createDiv({ cls: "cw-preview-location" });
      locationEl.setText(`${previewData.fileName}/${previewData.h1Title}`);

      const actionsEl = headerEl.createDiv({ cls: "cw-preview-actions" });
      const searchBtn = actionsEl.createEl("button", {
        cls: "cw-preview-btn",
        attr: { "aria-label": "搜索", title: "搜索" },
      });
      setIcon(searchBtn, "search");
      searchBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.openGlobalSearch(previewData.keyword);
      });

      const editBtn = actionsEl.createEl("button", {
        cls: "cw-preview-btn",
        attr: { "aria-label": "编辑", title: "编辑" },
      });
      setIcon(editBtn, "pen");
      editBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.openKeywordSource(previewData);
      });

      if (previewData.aliases.length > 0) {
        const blankLineEl = this.previewEl.createDiv({ cls: "cw-preview-blank-line" });
        blankLineEl.setText(" ");

        const aliasLabelEl = this.previewEl.createDiv({ cls: "cw-preview-label" });
        aliasLabelEl.setText("别名");

        const aliasValueEl = this.previewEl.createDiv({ cls: "cw-preview-aliases" });
        aliasValueEl.setText(previewData.aliases.join(" "));
      }

      this.previewEl.createDiv({ cls: "cw-preview-divider" });

      const bodyContainer = this.previewEl.createDiv({ cls: "cw-preview-body" });
      if (previewData.bodyLines.length === 0) {
        bodyContainer.createDiv({ cls: "cw-preview-empty", text: "（无设定内容）" });
      } else {
        const bodyListEl = bodyContainer.createEl("ul", { cls: "cw-preview-list" });
        for (const line of previewData.bodyLines) {
          const lineEl = bodyListEl.createEl("li", { cls: "cw-preview-line" });
          lineEl.setText(line);
        }
      }

      this.previewHoverKey = hoverKey;
      this.previewAnchorEl = anchorEl;
      this.currentPreviewData = previewData;
    }

    const previewStyle = this.plugin.settings.highlightPreviewStyle;
    this.previewEl.style.width = `${previewStyle.width}px`;
    this.previewEl.style.maxHeight = `${previewStyle.height}px`;
    this.previewEl.style.setProperty("--cw-preview-max-lines", String(previewStyle.maxBodyLines));
    this.previewEl.style.display = "flex";
    this.applyBodyMaxHeight(previewStyle.height, previewStyle.maxBodyLines);

    // 预览栏只在首次出现时定位，避免跟随鼠标不断抖动
    if (isNewHover || isNewAnchor) {
      this.previewAnchorEl = anchorEl;
      const offset = 14;
      let left = mouseX + offset;
      let top = mouseY + offset;
      const rect = this.previewEl.getBoundingClientRect();

      if (left + rect.width > window.innerWidth - 8) {
        left = Math.max(8, mouseX - rect.width - offset);
      }
      if (top + rect.height > window.innerHeight - 8) {
        top = Math.max(8, mouseY - rect.height - offset);
      }

      this.previewEl.style.left = `${left}px`;
      this.previewEl.style.top = `${top}px`;
    }
  }

  private hidePreview(): void {
    this.clearScheduledHidePreview();
    if (!this.previewEl) return;
    this.previewEl.style.display = "none";
    this.previewHoverKey = "";
    this.previewAnchorEl = null;
    this.currentPreviewData = null;
  }

  private scheduleHidePreview(delayMs = this.previewHideDelayMs): void {
    this.clearScheduledHidePreview();
    this.previewHideTimer = window.setTimeout(() => {
      this.hidePreview();
    }, delayMs);
  }

  private clearScheduledHidePreview(): void {
    if (this.previewHideTimer !== null) {
      window.clearTimeout(this.previewHideTimer);
      this.previewHideTimer = null;
    }
  }

  private applyBodyMaxHeight(previewHeightPx: number, maxBodyLines: number): void {
    if (!this.previewEl) return;
    const bodyEl = this.previewEl.querySelector(".cw-preview-body") as HTMLElement | null;
    if (!bodyEl) return;

    const approxLineHeightPx = 21;
    const desiredBodyHeight = Math.max(40, maxBodyLines * approxLineHeightPx);
    const nonBodyHeight = Math.max(0, this.previewEl.offsetHeight - bodyEl.offsetHeight);
    const availableBodyHeight = Math.max(40, previewHeightPx - nonBodyHeight - 4);
    const finalMaxBodyHeight = Math.min(desiredBodyHeight, availableBodyHeight);

    bodyEl.style.maxHeight = `${finalMaxBodyHeight}px`;
  }

  private async openGlobalSearch(keyword: string): Promise<void> {
    const query = keyword.trim();
    if (!query) return;

    const commandManager = (this.app as unknown as {
      commands?: { executeCommandById: (id: string) => boolean | Promise<boolean> };
    }).commands;
    if (commandManager) {
      await commandManager.executeCommandById("global-search:open");
    }

    window.setTimeout(() => {
      const searchLeaves = this.app.workspace.getLeavesOfType("search");
      if (searchLeaves.length === 0) return;

      const searchView = searchLeaves[0]?.view;
      const container = searchView?.containerEl;
      if (!container) return;

      const input = container.querySelector("input") as HTMLInputElement | null;
      if (!input) return;

      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.focus();
    }, 80);
  }

  private async openKeywordSource(previewData: KeywordPreviewData): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(previewData.filePath);
    if (!(abstractFile instanceof TFile)) return;

    const content = await this.app.vault.read(abstractFile);
    const lines = content.split("\n");
    const targetLine = this.findFirstContentLine(lines, previewData.h1Title, previewData.h2Title);

    const targetLeaf = await this.plugin.openFileWithSettings(abstractFile, { revealWhenNewTab: true });
    if (!targetLeaf) return;

    const targetView = targetLeaf.view instanceof MarkdownView ? targetLeaf.view : null;
    if (!targetView?.editor) return;

    targetView.editor.setCursor({ line: targetLine, ch: 0 });
    this.hidePreview();
  }

  private findFirstContentLine(lines: string[], h1Title: string, h2Title: string): number {
    let inTargetH1 = false;
    let inTargetH2 = false;
    let h2Line = 0;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]?.trim() ?? "";

      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        inTargetH1 = trimmed.slice(2).trim() === h1Title;
        inTargetH2 = false;
        continue;
      }

      if (inTargetH1 && trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
        const currentH2 = trimmed.slice(3).trim();
        inTargetH2 = currentH2 === h2Title;
        if (inTargetH2) {
          h2Line = i;
        }
        continue;
      }

      if (inTargetH2) {
        if (trimmed.startsWith("#")) break;
        if (trimmed.length > 0) {
          return i;
        }
      }
    }

    return h2Line;
  }

  /**
   * 创建编辑器扩展
   */
  createEditorExtension() {
    const manager = this;

    return ViewPlugin.fromClass(
      class implements PluginValue {
        decorations: DecorationSet = Decoration.none;
        currentFile: TFile | null = null;
        keywordsVersionSeen = -1;

        constructor(view: EditorView) {
          this.keywordsVersionSeen = manager.getKeywordsVersion();
          this.updateDecorations(view);
        }

        async updateDecorations(view: EditorView) {
          // 获取当前编辑器对应的 Markdown 视图
          const markdownView = manager.getMarkdownViewForEditorView(view);
          if (!markdownView || !markdownView.file) {
            this.decorations = Decoration.none;
            return;
          }

          const file = markdownView.file;
          this.currentFile = file;
          this.keywordsVersionSeen = manager.getKeywordsVersion();

          // 获取对应的设定库
          const settingFolder = manager.getSettingFolderForFile(file.path);
          if (!settingFolder) {
            this.decorations = Decoration.none;
            return;
          }

          // 提取关键字
          const keywords = await manager.extractKeywordsFromSettingFolder(settingFolder);

          if (keywords.size === 0) {
            this.decorations = Decoration.none;
            return;
          }

          // 创建装饰器
          const builder = new RangeSetBuilder<Decoration>();
          const doc = view.state.doc;
          const text = doc.toString();

          // 收集所有匹配位置
          const matches: { from: number; to: number; keyword: string }[] = [];
          const keywordGroupMap = manager.getKeywordGroupMap(settingFolder);

          // 获取高亮模式
          const highlightMode = manager.plugin.settings.highlightStyle.mode;

          // 为每个关键字查找匹配
          for (const keyword of keywords) {
            // 转义特殊字符
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedKeyword, 'g');

            let match;
            while ((match = regex.exec(text)) !== null) {
              matches.push({
                from: match.index,
                to: match.index + keyword.length,
                keyword,
              });
            }
          }

          const finalMatches =
            highlightMode === "first"
              ? (() => {
                const firstByGroup = new Map<string, { from: number; to: number; keyword: string }>();
                const sortedMatches = [...matches].sort((a, b) => a.from - b.from);
                for (const match of sortedMatches) {
                  const groupId = keywordGroupMap.get(match.keyword) ?? `kw::${match.keyword}`;
                  if (!firstByGroup.has(groupId)) {
                    firstByGroup.set(groupId, match);
                  }
                }
                return Array.from(firstByGroup.values());
              })()
              : matches;

          // 按位置排序并添加装饰器
          finalMatches.sort((a, b) => a.from - b.from);

          for (const match of finalMatches) {
            builder.add(
              match.from,
              match.to,
              Decoration.mark({
                class: "chinese-writer-highlight",
                attributes: {
                  "data-cw-keyword": match.keyword,
                  "data-cw-setting-folder": settingFolder,
                },
              })
            );
          }

          this.decorations = builder.finish();

          // 异步计算完成后主动触发一次轻量事务，立即重绘装饰器
          view.dispatch({
            annotations: Transaction.addToHistory.of(false),
          });
        }

        update(update: ViewUpdate) {
          // 文档变化或关键字缓存失效时，重新计算装饰器
          const keywordsChanged = this.keywordsVersionSeen !== manager.getKeywordsVersion();
          if (update.docChanged || keywordsChanged) {
            this.updateDecorations(update.view);
          }
        }

        destroy() {
          // 清理
        }
      },
      {
        decorations: (value) => value.decorations
      }
    );
  }

  /**
   * 更新高亮样式
   */
  updateStyles(): void {
    const style = this.plugin.settings.highlightStyle;

    // 移除旧的样式
    const oldStyle = document.getElementById("chinese-writer-highlight-style");
    if (oldStyle) {
      oldStyle.remove();
    }

    // 创建新的样式
    const styleEl = document.createElement("style");
    styleEl.id = "chinese-writer-highlight-style";
    styleEl.textContent = `
      .chinese-writer-highlight {
        background-color: ${style.backgroundColor};
        border-bottom: ${style.borderWidth}px ${style.borderStyle} ${style.borderColor};
        font-weight: ${style.fontWeight};
        font-style: ${style.fontStyle};
        color: ${style.color};
        padding-bottom: 2px;
      }
    `;
    document.head.appendChild(styleEl);
  }
}
