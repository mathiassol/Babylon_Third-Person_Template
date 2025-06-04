# 3D Game with Babylon.js

A 3D game project built with Babylon.js, featuring a Node.js server for multiplayer functionality.

## Features

- 3D rendering with Babylon.js
- Multiplayer support via WebSocket
- Physics simulation with Ammo.js
- Interactive GUI elements
- Save game functionality

## Prerequisites

- Node.js (v16 or later recommended)
- npm (comes with Node.js)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd puzzle
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

### Development Mode

Start the development server:
```bash
npm start
```

The game will be available at `http://localhost:3000`

### Electron App

To run as a desktop application:
```bash
npm run startE
```

## Project Structure

- `/public` - Static assets and client-side code
- `server.js` - Main server file with WebSocket handling
- `package.json` - Project configuration and dependencies

## Dependencies

- **@babylonjs/core**: Core 3D engine
- **@babylonjs/gui**: UI components
- **@babylonjs/havok**: Physics engine
- **express**: Web server
- **ws**: WebSocket server
- **electron**: Desktop application wrapper

## Contributing

1. Fork the repository
2. Create a new branch for your feature
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.