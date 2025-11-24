import fs from 'fs/promises';
import path from 'path';

export type LogLevel = 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS';

export interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    message: string;
    details?: any;
}

const LOG_FILE_PATH = path.join(process.cwd(), '.cache', 'activity-logs.json');

async function ensureLogFile() {
    try {
        await fs.access(LOG_FILE_PATH);
    } catch {
        const dir = path.dirname(LOG_FILE_PATH);
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
        await fs.writeFile(LOG_FILE_PATH, JSON.stringify([]));
    }
}

export async function log(level: LogLevel, message: string, details?: any) {
    await ensureLogFile();
    try {
        const content = await fs.readFile(LOG_FILE_PATH, 'utf-8');
        let logs: LogEntry[] = [];
        try {
            logs = JSON.parse(content);
        } catch (e) {
            // If file is corrupted, start fresh
            logs = [];
        }

        const newEntry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level,
            message,
            details,
        };

        // Keep only the last 1000 logs to prevent infinite growth
        const updatedLogs = [newEntry, ...logs].slice(0, 1000);

        await fs.writeFile(LOG_FILE_PATH, JSON.stringify(updatedLogs, null, 2));
    } catch (error) {
        console.error('Failed to write to log file:', error);
    }
}

export async function getLogs(): Promise<LogEntry[]> {
    await ensureLogFile();
    try {
        const content = await fs.readFile(LOG_FILE_PATH, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Failed to read logs:', error);
        return [];
    }
}

export async function clearLogs() {
    await ensureLogFile();
    await fs.writeFile(LOG_FILE_PATH, JSON.stringify([]));
}
