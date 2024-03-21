import {emmiter}  from "./coordinator.js";


export class notificationManager {
    constructor() {
        emmiter.on("notification", (notification) => {
            console.log("notification",notification);  
        
        })
    }
    
}

