import type ChineseWriterPlugin from "./main";

/**
 * 编辑区排版管理器
 * 负责编辑视图中的行首缩进、行间距和段间距样式注入
 */
export class EditorTypographyManager {
  private plugin: ChineseWriterPlugin;

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
  }

  updateStyles(): void {
    const oldStyle = document.getElementById("chinese-writer-editor-typography-style");
    if (oldStyle) {
      oldStyle.remove();
    }

    if (!this.plugin.settings.enableEditorTypography) {
      return;
    }

    const indentChars = Math.max(0, this.plugin.settings.editorIndentCjkChars ?? 0);
    const lineHeight = Math.max(1, this.plugin.settings.editorLineHeight ?? 1.8);
    const paragraphSpacing = Math.max(0, this.plugin.settings.editorParagraphSpacing ?? 0);
    const justifyCss = this.plugin.settings.enableEditorJustify
      ? `
      .cm-s-obsidian {
        text-align: justify;
        hyphens: auto;
      }
      `
      : "";

    const styleEl = document.createElement("style");
    styleEl.id = "chinese-writer-editor-typography-style";
    styleEl.textContent = `
      .markdown-source-view.mod-cm6 .cm-line {
        line-height: ${lineHeight};
      }

      .markdown-source-view.mod-cm6 .cm-line:not(.HyperMD-codeblock):not(.HyperMD-header):not(.HyperMD-list-line):not(.HyperMD-quote) {
        text-indent: calc(${indentChars} * 1em);
        padding-top: calc(${paragraphSpacing}px / 2);
        padding-bottom: calc(${paragraphSpacing}px / 2);
        box-sizing: border-box;
      }
      ${justifyCss}
    `;
    document.head.appendChild(styleEl);
  }
}
