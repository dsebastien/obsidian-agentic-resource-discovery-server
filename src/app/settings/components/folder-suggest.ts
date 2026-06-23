import { AbstractInputSuggest, type App, type TAbstractFile, TFolder } from 'obsidian'

/**
 * Autocomplete suggester for vault folders.
 *
 * Attaches to a text input and offers matching vault folders as the user types.
 * On select it writes the folder path and fires an `input` event so the bound
 * `onChange` handler runs. (Shared component reused across the author's plugins.)
 *
 * Note: it suggests vault-relative paths. Skill folders may live outside the
 * vault too — users can still type an absolute path, and the plugin resolves
 * relative paths against the vault base path before scanning.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    constructor(
        private inputEl: HTMLInputElement,
        app: App
    ) {
        super(app, inputEl)
    }

    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles()
        const folders: TFolder[] = []
        const lowerCaseInputStr = inputStr.toLowerCase()

        abstractFiles.forEach((file: TAbstractFile) => {
            if (file instanceof TFolder && file.path.toLowerCase().contains(lowerCaseInputStr)) {
                folders.push(file)
            }
        })

        return folders
    }

    override renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path)
    }

    override selectSuggestion(folder: TFolder): void {
        this.inputEl.value = folder.path
        this.inputEl.trigger('input')
        this.close()
    }
}
