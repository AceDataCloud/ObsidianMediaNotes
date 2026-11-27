import { App, Editor, MarkdownView, Modal, Notice, Plugin, SecretComponent, Setting, TFile, requestUrl } from 'obsidian';
import { icons } from './icons';
import { Asset, Service, maxBytes, mediaExtension, services, taskResult } from './services';

const applicationLink = 'https://platform.acedata.cloud/console/applications?utm_source=obsidian&utm_medium=referral&utm_campaign=evergreen';
const serviceIds = Object.keys(services) as Service[];
type Preferences = { service: Service; secrets: Partial<Record<Service, string>> };

export default class MediaAttachments extends Plugin {
  preferences: Preferences = { service: 'suno', secrets: {} };
  // The host provides cross-origin requests on mobile and desktop.
  request = requestUrl;

  async onload() {
    const saved = await this.loadData() as Partial<Preferences> | null;
    if (saved?.service && serviceIds.includes(saved.service)) this.preferences.service = saved.service;
    for (const id of serviceIds) {
      const secret = saved?.secrets?.[id];
      if (typeof secret === 'string') this.preferences.secrets[id] = secret;
    }
    this.addCommand({
      id: 'import-attachment', name: 'Import media from a task', icon: 'file-down',
      editorCallback: (editor, info) => {
        if (info.file) new ImportModal(this.app, this, editor, info.file).open();
      }
    });
  }
}

class ImportModal extends Modal {
  private service: Service;
  private generation = 0;
  private id = '';
  private openForImports = false;
  private saving = false;
  private icon!: HTMLImageElement;
  private secretEl!: HTMLElement;
  private results!: HTMLElement;
  private lookupButton!: HTMLButtonElement;

  constructor(app: App, private plugin: MediaAttachments, private editor: Editor, private note: TFile) {
    super(app);
    this.service = plugin.preferences.service;
  }

  onOpen() {
    this.openForImports = true;
    this.setTitle('Import media from a task');
    const root = this.contentEl;
    const select = new Setting(root).setName('Service').setDesc('Choose the service that created the task.');
    this.icon = select.controlEl.createEl('img', { cls: 'ace-media-service-icon', attr: { alt: '' } });
    this.icon.src = icons[this.service];
    select.addDropdown(dropdown => {
      for (const id of serviceIds) dropdown.addOption(id, services[id].name);
      dropdown.setValue(this.service).onChange(value => {
        this.service = value as Service;
        this.plugin.preferences.service = this.service;
        void this.plugin.saveData(this.plugin.preferences);
        this.icon.src = icons[this.service];
        this.renderSecret();
        this.invalidate();
      });
    });
    const key = new Setting(root).setName('Application key');
    key.descEl.appendText('Choose an Obsidian secret for this service. ');
    key.descEl.createEl('a', { text: 'Manage application keys', href: applicationLink });
    this.secretEl = key.controlEl;
    this.renderSecret();
    new Setting(root).setName('Task ID').addText(input => {
      input.setPlaceholder('Existing task ID').onChange(value => { this.id = value.trim(); this.invalidate(); });
      input.inputEl.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !this.lookupButton.disabled) { event.preventDefault(); void this.lookup(); }
      });
    }).addButton(button => {
      button.setButtonText('Find media').setCta().onClick(() => this.lookup());
      this.lookupButton = button.buttonEl;
    });
    this.results = root.createDiv({ cls: 'ace-media-results', attr: { 'aria-live': 'polite' } });
    this.lookupButton.disabled = true;
  }

  private renderSecret() {
    const service = this.service;
    this.secretEl.empty();
    new SecretComponent(this.app, this.secretEl).setValue(this.plugin.preferences.secrets[service] ?? '').onChange(name => {
      if (name) this.plugin.preferences.secrets[service] = name;
      else delete this.plugin.preferences.secrets[service];
      this.invalidate();
      void this.plugin.saveData(this.plugin.preferences);
    });
  }

  private invalidate() {
    this.generation++;
    this.results?.empty();
    if (this.lookupButton) this.lookupButton.disabled = !this.id || this.saving;
  }

  private active(seq: number) { return this.openForImports && this.generation === seq; }
  private originalEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file === this.note && view.editor === this.editor;
  }

  private async lookup() {
    const service = this.service, id = this.id, seq = ++this.generation;
    this.results.empty();
    const secretName = this.plugin.preferences.secrets[service];
    const token = secretName ? this.app.secretStorage.getSecret(secretName)?.trim() : '';
    if (!token) { this.results.setText('Choose an application key for this service.'); return; }
    if (!id || this.saving) return;
    this.lookupButton.disabled = true;
    this.results.setText('Looking up task…');
    try {
      const response = await this.plugin.request({ url: `https://api.acedata.cloud/${service}/tasks`, method: 'POST',
        headers: { Authorization: `Bearer ${token}` }, contentType: 'application/json', body: JSON.stringify({ action: 'retrieve', id }), throw: false });
      if (!this.active(seq)) return;
      if (response.status < 200 || response.status >= 300) {
        this.results.setText(`Task lookup returned HTTP ${response.status}. Check the task ID, service, and application key.`); return;
      }
      const task = taskResult(service, id, response.json);
      this.results.empty();
      if (!task.assets.length) { this.results.setText(`No downloadable media. Task status: ${task.state}.`); return; }
      for (const [index, item] of task.assets.entries()) {
        new Setting(this.results).setName(item.title).setDesc(new URL(item.url).hostname).addButton(button =>
          button.setButtonText('Import').onClick(() => this.importAsset(item, service, seq, index)));
      }
    } catch (error) {
      if (this.active(seq)) this.results.setText(error instanceof SyntaxError ? 'The task response was not valid JSON.' : 'Unable to read this task. Check your connection, service, and task ID.');
    } finally { if (this.active(seq)) this.lookupButton.disabled = false; }
  }

  private async importAsset(asset: Asset, service: Service, seq: number, index: number) {
    if (this.saving || !this.active(seq)) return;
    if (!this.originalEditor()) { new Notice('Open the original note and run the import again.'); return; }
    this.saving = true;
    this.lookupButton.disabled = true;
    const buttons = Array.from(this.results.querySelectorAll('button'));
    buttons.forEach(b => b.disabled = true);
    try {
      // Media hosts receive only the selected download request. The API key belongs to api.acedata.cloud.
      const response = await this.plugin.request({ url: asset.url, method: 'GET', throw: false });
      if (!this.active(seq)) return;
      if (response.status < 200 || response.status >= 300) throw new Error(`Download returned HTTP ${response.status}.`);
      const bytes = response.arrayBuffer;
      if (bytes.byteLength > maxBytes) throw new Error('This attachment exceeds the 64 MiB import limit.');
      const extension = mediaExtension(services[service].kind, new Uint8Array(bytes));
      const id = this.id.replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'task';
      const path = await this.app.fileManager.getAvailablePathForAttachment(`${service}-${id}-${index + 1}.${extension}`, this.note.path);
      if (!this.active(seq) || !this.originalEditor()) return;
      const file = await this.app.vault.createBinary(path, bytes);
      if (!this.active(seq) || !this.originalEditor()) { new Notice(`Attachment saved to ${file.path}.`); return; }
      const link = this.app.fileManager.generateMarkdownLink(file, this.note.path);
      this.editor.replaceSelection(link.startsWith('!') ? link : `!${link}`);
      this.close();
    } catch (error) {
      if (this.active(seq)) new Notice(error instanceof Error ? error.message : 'Unable to import this attachment.');
    } finally {
      this.saving = false;
      if (this.openForImports) this.lookupButton.disabled = !this.id;
      buttons.forEach(b => b.disabled = false);
    }
  }

  onClose() { this.openForImports = false; this.generation++; this.contentEl.empty(); }
}
