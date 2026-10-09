# SDO MIREA MCP Server

This is an MCP (Model Context Protocol) server designed to interact with the SDO MIREA platform (Система Дистанционного Обучения МИРЭА, online-edu.mirea.ru), which is based on Moodle.

This server provides AI agents with tools to interact with your Moodle account without requiring special Web Service API tokens (which are often restricted by university administrators). It operates using your standard browser session cookie.

## Features

Provides AI agents with tools to:
- `get_user_courses`: List all courses you are currently enrolled in, along with your progress.
- `get_upcoming_assignments`: View upcoming deadlines, tests, and tasks across all your courses.

## Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Build the TypeScript code:
```bash
npm run build
```

## Configuration

To use this server, you need to provide your active Moodle session cookie (`MoodleSession`). 

### How to get your MoodleSession cookie:
1. Open your browser and log in to [online-edu.mirea.ru](https://online-edu.mirea.ru).
2. Open Developer Tools (press `F12`).
3. Navigate to the **Application** tab (or **Storage** in Firefox).
4. Expand the **Cookies** section on the left sidebar and select `https://online-edu.mirea.ru`.
5. Find the row where the Name is `MoodleSession` and copy its Value.

### Environment Variables

Create a `.env` file in the root directory if you are running it standalone:
```env
MOODLE_SESSION=your_moodle_session_cookie_value
SDO_BASE_URL=https://online-edu.mirea.ru
```

### Adding to an MCP Client (e.g., Claude Desktop, Antigravity, Cursor)

Add the following to your MCP client's configuration file (e.g., `mcp_config.json`, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sdo-mirea": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-sdo/build/index.js"],
      "env": {
        "MOODLE_SESSION": "your_moodle_session_cookie_value"
      }
    }
  }
}
```

*Note: The `MoodleSession` cookie is relatively long-lived, but if the server stops responding or returns authentication errors, you will need to re-login in your browser and update the cookie in your configuration.*

## Development

- Start compiling in watch mode: `npm run watch` (you can add this to your package.json scripts)
- Build manually: `npm run build`
