# CLI Example Usage

## Quick Start

1. **Start VS Code extension**:
   - Press `F5` in the vfs-extension folder to launch the debug instance
   - Or install the extension and run it normally

2. **Get the callback URL**:
   - In VS Code, run command: "Connect to Virtual File System" (or click the button in Explorer)
   - Choose "Copy URL" from the dialog
   - The URL will look like: `https://example.com/connect?vscode_ws=ws://localhost:54321&token=abc123`

3. **Run the CLI example**:
   ```bash
   cd vfs-browser-client
   npm run example -- "YOUR_CALLBACK_URL_HERE"
   ```

   Example:
   ```bash
   npm run example -- "https://example.com/connect?vscode_ws=ws://localhost:54321&token=abc123"
   ```

4. **Edit files in VS Code**:
   - The virtual file system will appear in VS Code
   - Edit any file (README.md, src/index.ts, etc.)
   - Changes will be logged in the CLI terminal

## What's Included

The example creates a virtual file system with:
- `/README.md` - Project documentation
- `/.gitignore` - Git ignore file
- `/package.json` - Package configuration
- `/tsconfig.json` - TypeScript config
- `/src/index.ts` - Main source file
- `/src/utils.ts` - Utility functions

## How It Works

1. The CLI script creates an in-memory file system
2. Connects to VS Code's WebSocket server using the callback URL
3. VS Code can now read/write files through RPC calls
4. All file operations are logged to the console
5. Press Ctrl+C to disconnect

## Troubleshooting

**Connection timeout:**
- Make sure VS Code extension is running
- Check the WebSocket URL is correct
- Verify no firewall is blocking the connection

**WebSocket error:**
- The callback URL is only valid for a short time
- Generate a new callback URL in VS Code and try again

**Module errors:**
- Run `npm install` in the vfs-browser-client directory
- Make sure all dependencies are installed
