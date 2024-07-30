import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { notificationConfig } from './types.js';
import { notification } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class NotificationManager {
    private dir: string;
    constructor(settings : notificationConfig) {
      this.dir = settings.directory;

    }

    
    notify(notification : string) : void {
        fs.readdir(this.dir, (err, files) => {
            if (err) {
                console.error(`Error reading directory: ${err}`);
                return;
            }
        
            files.forEach(file => {
                if (['.sh','.js','.bat'].includes(path.extname(file))){
                    console.log(`Executing ${this.dir} ${file}`);
                    exec(`"${path.join(__dirname , ".." ,this.dir, file)}" "${notification}"`, (err, stdout, stderr) => {
                        if (err) {
                            console.error(`Error executing ${file}: ${err}`);
                            return;
                        }
                    });
                }
            });
        });
    
    }
}