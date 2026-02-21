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
    const body = document.body;
    if (!body) return;

    if (!this.plugin.settings.enableEditorTypography) {
      body.removeClass("cw-editor-typography-enabled");
      body.removeClass("cw-editor-justify-enabled");
      body.style.removeProperty("--cw-editor-indent-cjk");
      body.style.removeProperty("--cw-editor-line-height");
      body.style.removeProperty("--cw-editor-paragraph-spacing");
      return;
    }

    const indentChars = Math.max(0, this.plugin.settings.editorIndentCjkChars ?? 0);
    const lineHeight = Math.max(1, this.plugin.settings.editorLineHeight ?? 1.8);
    const paragraphSpacing = Math.max(0, this.plugin.settings.editorParagraphSpacing ?? 0);

    body.addClass("cw-editor-typography-enabled");
    body.toggleClass("cw-editor-justify-enabled", this.plugin.settings.enableEditorJustify);
    body.style.setProperty("--cw-editor-indent-cjk", String(indentChars));
    body.style.setProperty("--cw-editor-line-height", String(lineHeight));
    body.style.setProperty("--cw-editor-paragraph-spacing", `${paragraphSpacing}px`);
  }
}
