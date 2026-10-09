import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.SDO_BASE_URL || "https://online-edu.mirea.ru";
const MOODLE_SESSION = process.env.MOODLE_SESSION;

let sesskey: string | null = null;

// Error handler for Axios to keep things clean
const handleAxiosError = (error: any) => {
  if (axios.isAxiosError(error)) {
    throw new McpError(
      ErrorCode.InternalError,
      `API Error: ${error.response?.status} - ${JSON.stringify(error.response?.data) || error.message}`
    );
  }
  throw error;
};

// Helper to fetch the sesskey automatically from the dashboard
const getSessKey = async () => {
  if (sesskey) return sesskey;
  if (!MOODLE_SESSION) {
    throw new McpError(ErrorCode.InvalidParams, "MOODLE_SESSION environment variable is not set");
  }

  try {
    const response = await axios.get(`${BASE_URL}/my/`, {
      headers: { Cookie: `MoodleSession=${MOODLE_SESSION}` }
    });
    
    // Attempt to extract sesskey from HTML
    const match = response.data.match(/sesskey":"([^"]+)"/) || response.data.match(/sesskey=([a-zA-Z0-9]+)/);
    if (match && match[1]) {
      sesskey = match[1];
      return sesskey;
    }
    throw new Error("Could not find sesskey in dashboard HTML. Your session might be invalid or expired.");
  } catch (error) {
    handleAxiosError(error);
  }
};

// Helper for making requests to Moodle AJAX endpoints
const callMoodleAjax = async (methodname: string, args: Record<string, any> = {}) => {
  const currentSesskey = await getSessKey();
  
  try {
    const response = await axios.post(
      `${BASE_URL}/lib/ajax/service.php?sesskey=${currentSesskey}&info=${methodname}`,
      [{ index: 0, methodname, args }],
      {
        headers: {
          'Cookie': `MoodleSession=${MOODLE_SESSION}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data[0];
    if (data.error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Moodle AJAX Exception: ${data.exception.message} (${data.exception.errorcode})`
      );
    }

    return data.data;
  } catch (error) {
    handleAxiosError(error);
  }
};

class SDOServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "sdo-mirea-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_user_courses",
          description: "Get enrolled courses for the current user",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_upcoming_assignments",
          description: "Get upcoming assignments and tasks (calendar events) that require action",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Maximum number of events to fetch (default 20)" }
            },
          },
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "get_user_courses": {
          const data = await callMoodleAjax("core_course_get_enrolled_courses_by_timeline_classification", {
            offset: 0,
            limit: 0,
            classification: "all",
            sort: "fullname"
          });
          
          // Format output to be readable
          const formatted = (data.courses as any[]).map((c: any) => ({
            id: c.id,
            name: c.fullname,
            progress: c.progress,
            url: c.viewurl,
            category: c.coursecategory
          }));
          return {
            content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
          };
        }

        case "get_upcoming_assignments": {
          const { limit = 20 } = request.params.arguments as any;
          // timesortfrom: 0 gives us all upcoming
          const data = await callMoodleAjax("core_calendar_get_action_events_by_timesort", {
            timesortfrom: 0,
            limitnum: limit
          });
          
          const formatted = (data.events || []).map((e: any) => ({
            id: e.id,
            name: e.name,
            courseName: e.course.fullname,
            dueDate: new Date(e.timesort * 1000).toLocaleString(),
            action: e.action?.name,
            url: e.url,
            isOverdue: e.overdue
          }));
          
          return {
            content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
          };
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("SDO MIREA MCP server running on stdio via MoodleSession");
  }
}

const server = new SDOServer();
server.run().catch(console.error);
