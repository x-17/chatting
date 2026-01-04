declare module 'docx-preview' {
    export function renderAsync(
        data: Blob | ArrayBuffer | Uint8Array,
        element: HTMLElement,
        style?: any,
        docxOptions?: any
    ): Promise<void>;
}
