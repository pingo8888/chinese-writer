import { App, TFile, MarkdownView, editorLivePreviewField } from "obsidian";
import type ChineseWriterPlugin from "./main";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, PluginValue } from "@codemirror/view";
import { RangeSetBuilder, Transaction } from "@codemirror/state";

/**
 * 高亮管理器
 * 负责在编辑器中高亮显示设定库中的关键字
 */
export class HighlightManager {
  plugin: ChineseWriterPlugin;
  app: App;
  private keywordsCache: Map<string, Set<string>> = new Map();
  private keywordsVersion = 0;

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
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
    if (this.keywordsCache.has(settingFolder)) {
      return this.keywordsCache.get(settingFolder)!;
    }

    const keywords = new Set<string>();

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
            if (h2.text.trim()) {
              keywords.add(h2.text.trim());
            }
          }
        }
      }
    }

    // 缓存结果
    this.keywordsCache.set(settingFolder, keywords);

    return keywords;
  }

  /**
   * 清除关键字缓存
   */
  clearCache(): void {
    this.keywordsCache.clear();
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
          const matches: { from: number; to: number }[] = [];

          // 获取高亮模式
          const highlightMode = manager.plugin.settings.highlightStyle.mode;

          // 为每个关键字查找匹配
          for (const keyword of keywords) {
            // 转义特殊字符
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedKeyword, 'g');

            let match;
            let foundFirst = false;
            while ((match = regex.exec(text)) !== null) {
              // 如果是首次高亮模式,只添加第一个匹配
              if (highlightMode === "first" && foundFirst) {
                continue;
              }

              matches.push({
                from: match.index,
                to: match.index + keyword.length
              });

              foundFirst = true;
            }
          }

          // 按位置排序并添加装饰器
          matches.sort((a, b) => a.from - b.from);

          for (const match of matches) {
            builder.add(
              match.from,
              match.to,
              Decoration.mark({
                class: "chinese-writer-highlight"
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
