const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
    const output = {
        updatedAt: new Date().toISOString(),
        message: "GitHub Actions is working!",
        players: []
    };

    await fs.mkdir("data", { recursive: true });

    await fs.writeFile(
        path.join("data","live-player-data.json"),
        JSON.stringify(output,null,2)
    );

    console.log("Player data updated.");
}

main();
