import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import {emitter}  from "./coordinator.js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { notificationConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class notificationManager {

    constructor(settings : notificationConfig) {
        const dir = settings.directory;
        emitter.on("notification", (notification) => {
            fs.readdir(dir, (err, files) => {
                if (err) {
                    console.error(`Error reading directory: ${err}`);
                    return;
                }
            
                files.forEach(file => {
                    if (['.sh','.js','.bat'].includes(path.extname(file))){
                        console.log(`Executing ${dir} ${file}`);
                        exec(`"${path.join(__dirname , ".." ,dir, file)}" "${notification}"`, (err, stdout, stderr) => {
                            if (err) {
                                console.error(`Error executing ${file}: ${err}`);
                                return;
                            }
                        });
                    }
                });
            });
        
        })
    }
}