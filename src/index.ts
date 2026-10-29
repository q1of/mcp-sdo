import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { MoodleClient } from "./moodle-client.js";

dotenv.config();

class SDOServer {
  private server: Server;
  private client: MoodleClient;

  constructor() {
    this.client = new MoodleClient();
    this.server = new Server(
      {
        name: "sdo-mirea-server",
        version: "2.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

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
          description:
            "Получить список всех дисциплин (курсов), на которые записан студент в СДО МИРЭА, с информацией о прогрессе и ссылках.",
          inputSchema: {
            type: "object",
            properties: {
              classification: {
                type: "string",
                description: "Фильтр курсов: 'all' (все, по умолчанию), 'inprogress' (текущие), 'past' (прошедшие), 'future' (будущие)",
                enum: ["all", "inprogress", "past", "future"],
                default: "all",
              },
            },
          },
        },
        {
          name: "get_course_structure",
          description:
            "Получить полное дерево структуры курса: все разделы/темы, лекции, презентации, методички, задания (ДЗ/ПР/КР), тесты и опросы с их статусами.",
          inputSchema: {
            type: "object",
            properties: {
              course_id: {
                type: "string",
                description: "ID курса (число) или полный URL курса в СДО (например, 'https://online-edu.mirea.ru/course/view.php?id=23171')",
              },
            },
            required: ["course_id"],
          },
        },
        {
          name: "get_assignment_details",
          description:
            "Получить детальную информацию о конкретном задании: полное описание/инструкцию, прикрепленные файлы (методички, шаблоны), классификацию типа (КР / ПР / ДЗ / ЛР), детекцию формата сдачи (ОЧНО в аудитории или ДИСТАНЦИОННО в СДО), дедлайн и статус оценивания.",
          inputSchema: {
            type: "object",
            properties: {
              id_or_url: {
                type: "string",
                description: "ID модуля задания (число) или полный URL задания (например, 'https://online-edu.mirea.ru/mod/assign/view.php?id=949361')",
              },
            },
            required: ["id_or_url"],
          },
        },
        {
          name: "get_quiz_details",
          description:
            "Получить подробности о тесте или опросе: инструкции, ограничение по времени, количество попыток, метод оценивания и статус прохождения.",
          inputSchema: {
            type: "object",
            properties: {
              id_or_url: {
                type: "string",
                description: "ID теста/опроса (число) или полный URL (например, 'https://online-edu.mirea.ru/mod/quiz/view.php?id=...')",
              },
            },
            required: ["id_or_url"],
          },
        },
        {
          name: "get_resource_content",
          description:
            "Прочитать текст страницы курса, лекции, методического материала или получить список файлов из папки курса.",
          inputSchema: {
            type: "object",
            properties: {
              id_or_url: {
                type: "string",
                description: "ID ресурса/страницы (число) или полный URL (например, '/mod/page/view.php?id=...' или '/mod/folder/view.php?id=...')",
              },
            },
            required: ["id_or_url"],
          },
        },
        {
          name: "download_material",
          description:
            "Скачать файл из СДО МИРЭА (презентацию, методичку, шаблон задания docx, pdf, zip) и сохранить его в локальную папку проекта.",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Прямая ссылка на скачивание файла (например, ссылка pluginfile.php из get_assignment_details или get_course_structure)",
              },
              target_path: {
                type: "string",
                description: "Относительный или абсолютный путь для сохранения файла (например, 'assignments/Алгоритмы/ПР-2/task.docx' или 'materials/lecture1.pdf')",
              },
            },
            required: ["url", "target_path"],
          },
        },
        {
          name: "get_deadlines_summary",
          description:
            "Получить сводку дедлайнов и заданий, сгруппированных по категориям: 'overdue' (просроченные долги), 'this_week' (на ближайшую неделю), 'upcoming' (будущие). Автоматически определяет очный/дистанционный формат и тип заданий.",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Количество событий календаря (от 1 до 50, по умолчанию 50)",
                default: 50,
              },
              filter: {
                type: "string",
                description: "Фильтр: 'all' (все события), 'overdue' (только долги), 'upcoming' (только актуальные)",
                enum: ["all", "overdue", "upcoming"],
                default: "all",
              },
              check_in_person: {
                type: "boolean",
                description: "Проверять ли детально каждое задание на признак очного выполнения в аудитории (по умолчанию true)",
                default: true,
              },
            },
          },
        },
        {
          name: "search_course_materials",
          description:
            "Поиск материалов, лекций, презентаций и заданий по ключевым словам по всем курсам студента или внутри конкретного курса.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Поисковый запрос (например, 'матрицы', 'лекция 2', 'кр-1', 'презентация')",
              },
              course_id: {
                type: "number",
                description: "Опциональный ID курса для ограничения поиска одним предметом",
              },
            },
            required: ["query"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "get_user_courses": {
            const { classification = "all" } = (request.params.arguments || {}) as any;
            const courses = await this.client.getUserCourses(classification);
            return {
              content: [{ type: "text", text: JSON.stringify(courses, null, 2) }],
            };
          }

          case "get_course_structure": {
            const { course_id } = request.params.arguments as any;
            const structure = await this.client.getCourseStructure(course_id);
            return {
              content: [{ type: "text", text: JSON.stringify(structure, null, 2) }],
            };
          }

          case "get_assignment_details": {
            const { id_or_url } = request.params.arguments as any;
            const details = await this.client.getAssignmentDetails(id_or_url);
            return {
              content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
            };
          }

          case "get_quiz_details": {
            const { id_or_url } = request.params.arguments as any;
            const details = await this.client.getQuizDetails(id_or_url);
            return {
              content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
            };
          }

          case "get_resource_content": {
            const { id_or_url } = request.params.arguments as any;
            const content = await this.client.getResourceContent(id_or_url);
            return {
              content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
            };
          }

          case "download_material": {
            const { url, target_path } = request.params.arguments as any;
            const result = await this.client.downloadMaterial(url, target_path);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "get_deadlines_summary": {
            const { limit = 50, filter = "all", check_in_person = true } = (request.params.arguments || {}) as any;
            const summary = await this.client.getDeadlinesSummary(limit, filter, check_in_person);
            return {
              content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
            };
          }

          case "search_course_materials": {
            const { query, course_id } = request.params.arguments as any;
            const results = await this.client.searchCourseMaterials(query, course_id);
            return {
              content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Неизвестный инструмент: ${request.params.name}`
            );
        }
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error?.message || String(error),
            },
          ],
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("SDO MIREA MCP Server 2.0 running on stdio");
  }
}

const server = new SDOServer();
server.run().catch(console.error);
