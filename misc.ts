// logging function, courtesy Mozilla
export function log(text: string, plainLog?: any) {
    let time = new Date()
    console.log("[" + time.toLocaleTimeString() + "] " + text)
    if (plainLog) {
        console.log(plainLog)
    }
}

export function assert(condition: boolean, message: string) {
    if (!condition) {
        throw message || "Assertion failed";
    }
}