import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import {emitter}  from "./coordinator.js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dir = './dist/notificationScripts'; // replace with your relative directory
export class notificationManager {
    constructor() {
        emitter.on("notification", (notification) => {
            fs.readdir(dir, (err, files) => {
                if (err) {
                    console.error(`Error reading directory: ${err}`);
                    return;
                }
            
                files.forEach(file => {
                    if (path.extname(file) === '.sh') {
                        console.log(`Executing ${dir} ${file}`);
                        exec(`"${path.join(__dirname,dir, file)}"`, (err, stdout, stderr) => {
                            if (err) {
                                console.error(`Error executing ${file}: ${err}`);
                                return;
                            }
            
                            console.log(`Output of ${file}: ${stdout}`);
                            console.error(`Errors of ${file}: ${stderr}`);
                        });
                    }
                });
            });
        
        })
    }
}