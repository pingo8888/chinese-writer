import { App, Modal } from "obsidian";

/**
 * 文本输入对话框
 */
export class TextInputModal extends Modal {
  private title: string;
  private placeholder: string;
  private defaultValue: string;
  private onSubmit: (value: string) => void;
  private submitted = false; // 防止重复提交

  constructor(
    app: App,
    title: string,
    placeholder: string,
    defaultValue: string,
    onSubmit: (value: string) => void
  ) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;

    // 设置 modal 容器的样式
    const modalEl = contentEl.closest(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.style.minHeight = "auto";
      modalEl.style.height = "auto";
      modalEl.style.maxWidth = "400px";
      modalEl.style.width = "90%";
    }

    // 设置 contentEl 的样式
    contentEl.style.padding = "1em";

    const titleEl = contentEl.createEl("h2", { text: this.title });
    titleEl.style.marginTop = "0";
    titleEl.style.marginBottom = "0.8em";
    titleEl.style.fontSize = "1.2em";

    const inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: this.placeholder,
      value: this.defaultValue,
    });
    inputEl.style.width = "100%";
    inputEl.style.marginBottom = "1em";
    inputEl.style.padding = "0.5em";

    // 自动聚焦并选中文本
    inputEl.focus();
    inputEl.select();

    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "0.5em";

    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    const submitBtn = buttonContainer.createEl("button", {
      text: "确定",
      cls: "mod-cta",
    });

    // 提交处理函数
    const doSubmit = () => {
      if (this.submitted) {
        return; // 防止重复提交
      }
      this.submitted = true;

      const value = inputEl.value;
      this.close();
      // 使用 setTimeout 确保 modal 完全关闭后再执行回调
      setTimeout(() => {
        this.onSubmit(value);
      }, 10);
    };

    submitBtn.addEventListener("click", doSubmit);

    // 回车提交
    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        doSubmit();
      } else if (e.key === "Escape") {
        this.close();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 确认对话框
 */
export class ConfirmModal extends Modal {
  private title: string;
  private message: string;
  private onConfirm: () => void;

  constructor(
    app: App,
    title: string,
    message: string,
    onConfirm: () => void
  ) {
    super(app);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;

    // 设置 modal 容器的样式
    const modalEl = contentEl.closest(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.style.minHeight = "auto";
      modalEl.style.height = "auto";
      modalEl.style.maxWidth = "400px";
      modalEl.style.width = "90%";
    }

    // 设置 contentEl 的样式
    contentEl.style.padding = "1em";

    const titleEl = contentEl.createEl("h2", { text: this.title });
    titleEl.style.marginTop = "0";
    titleEl.style.marginBottom = "0.8em";
    titleEl.style.fontSize = "1.2em";

    const messageEl = contentEl.createEl("p", { text: this.message });
    messageEl.style.marginBottom = "1em";

    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "0.5em";
    buttonContainer.style.marginTop = "0.5em";

    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    const confirmBtn = buttonContainer.createEl("button", {
      text: "确定",
      cls: "mod-warning",
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
