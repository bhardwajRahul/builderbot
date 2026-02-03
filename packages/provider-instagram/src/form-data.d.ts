declare module 'form-data' {
    import { ReadStream } from 'fs'
    class FormData {
        append(
            key: string,
            value: string | Buffer | ReadStream,
            options?: string | { filename?: string; contentType?: string }
        ): void
        getHeaders(): Record<string, string>
        getBuffer(): Buffer
        getLengthSync(): number
        getLength(callback: (err: Error | null, length: number) => void): void
        getBoundary(): string
        setBoundary(boundary: string): void
    }
    export default FormData
}
