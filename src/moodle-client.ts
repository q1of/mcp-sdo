import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import {
  classifyActivityCategory,
  classifyTask,
  detectInPerson,
  extractHtmlText,
  extractPluginFiles,
} from './classifier.js';
import {
  AssignmentDetails,
  CourseSection,
  CourseStructure,
  DeadlineEvent,
  DeadlinesSummary,
  QuizDetails,
  ResourceContent,
  SubmissionDetails,
} from './types.js';

export class MoodleClient {
  private baseUrl: string;
  private moodleSession: string;
  private sesskey: string | null = null;

  constructor() {
    this.baseUrl = (process.env.SDO_BASE_URL || 'https://online-edu.mirea.ru').replace(/\/+$/, '');
    this.moodleSession = process.env.MOODLE_SESSION || '';
  }

  private ensureAuth() {
    if (!this.moodleSession) {
      throw new Error(
        'MOODLE_SESSION environment variable is not configured. Please set MOODLE_SESSION with your active MoodleSession cookie.'
      );
    }
  }

  private handleAxiosError(error: any): never {
    if (axios.isAxiosError(error)) {
      const err = error as AxiosError;
      if (
        err.code === 'ERR_FR_TOO_MANY_REDIRECTS' ||
        err.response?.status === 303 ||
        err.response?.status === 302 ||
        (typeof err.response?.data === 'string' && err.response.data.includes('login/index.php'))
      ) {
        throw new Error(
          'Сессия СДО МИРЭА устарела или недействительна (MoodleSession cookie expired). ' +
            'Пожалуйста, откройте https://online-edu.mirea.ru в браузере, скопируйте свежее значение куки MoodleSession (F12 -> Application/Storage -> Cookies) и обновите переменную MOODLE_SESSION.'
        );
      }
      throw new Error(
        `Ошибка запроса к СДО (${err.response?.status || err.code || 'Network Error'}): ${
          typeof err.response?.data === 'object' ? JSON.stringify(err.response?.data) : err.message
        }`
      );
    }
    throw error;
  }

  public async getSessKey(): Promise<string> {
    if (this.sesskey) return this.sesskey;
    this.ensureAuth();

    try {
      const response = await axios.get(`${this.baseUrl}/my/`, {
        headers: {
          Cookie: `MoodleSession=${this.moodleSession}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      if (response.request?.path?.includes('login/index.php')) {
        throw new Error('Redirected to login page. Session expired.');
      }

      const html = typeof response.data === 'string' ? response.data : '';
      const match = html.match(/sesskey":"([^"]+)"/) || html.match(/sesskey=([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        this.sesskey = match[1];
        return this.sesskey;
      }

      throw new Error(
        'Не удалось извлечь sesskey из страницы личного кабинета. Возможно, сессия устарела.'
      );
    } catch (error) {
      return this.handleAxiosError(error);
    }
  }

  public async callAjax(methodname: string, args: Record<string, any> = {}): Promise<any> {
    const sesskey = await this.getSessKey();

    try {
      const response = await axios.post(
        `${this.baseUrl}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`,
        [{ index: 0, methodname, args }],
        {
          headers: {
            Cookie: `MoodleSession=${this.moodleSession}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        }
      );

      const res = response.data?.[0];
      if (!res) {
        throw new Error('Пустой ответ от Moodle AJAX сервиса');
      }

      if (res.error) {
        throw new Error(`Ошибка Moodle AJAX: ${res.exception?.message || 'Unknown error'} (${res.exception?.errorcode})`);
      }

      return res.data;
    } catch (error) {
      return this.handleAxiosError(error);
    }
  }

  public async fetchHtml(urlOrPath: string): Promise<cheerio.CheerioAPI> {
    this.ensureAuth();
    const url = urlOrPath.startsWith('http') ? urlOrPath : `${this.baseUrl}/${urlOrPath.replace(/^\/+/, '')}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Cookie: `MoodleSession=${this.moodleSession}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        maxRedirects: 5,
      });

      return cheerio.load(response.data);
    } catch (error) {
      return this.handleAxiosError(error);
    }
  }

  public async getUserCourses(classification: string = 'all'): Promise<any[]> {
    const data = await this.callAjax('core_course_get_enrolled_courses_by_timeline_classification', {
      offset: 0,
      limit: 0,
      classification,
      sort: 'fullname',
    });

    const courses = (data?.courses || []).map((c: any) => ({
      id: c.id,
      name: c.fullname,
      shortname: c.shortname,
      progress: c.progress !== null ? `${c.progress}%` : 'Не отслеживается',
      url: c.viewurl,
      category: c.coursecategory,
    }));

    return courses;
  }

  public async getCourseStructure(courseIdOrUrl: string | number): Promise<CourseStructure> {
    let url = '';
    let courseId = '';

    if (typeof courseIdOrUrl === 'number' || /^\d+$/.test(String(courseIdOrUrl))) {
      courseId = String(courseIdOrUrl);
      url = `${this.baseUrl}/course/view.php?id=${courseId}`;
    } else {
      url = String(courseIdOrUrl);
      const match = url.match(/id=(\d+)/);
      courseId = match ? match[1] : '';
    }

    const $ = await this.fetchHtml(url);

    const courseName = $('header#page-header h1, .page-header-headings h1, title')
      .first()
      .text()
      .replace(/:\s*Разделы.*$/, '')
      .replace(/\|\s*СДО.*$/, '')
      .trim();

    const sections: CourseSection[] = [];
    let totalActivities = 0;

    $('li.section, div.section.main').each((_, secElem) => {
      const sec = $(secElem);
      const secId = sec.attr('id') || `section-${sections.length}`;
      let title = sec.find('.sectionname, .section-title, h3.sectionname').first().text().trim();
      if (!title) {
        title = sec.attr('aria-label') || `Раздел ${sections.length}`;
      }

      const summary = extractHtmlText($, `${sec.attr('id') ? '#' + sec.attr('id') : ''} .summary`);

      const items: any[] = [];

      sec.find('li.activity, div.activity').each((_, actElem) => {
        const act = $(actElem);
        const actId = act.attr('id')?.replace(/^module-/, '') || '';
        const link = act.find('a.aal_full, .activityinstance a, a').first();
        const actUrl = link.attr('href') || '';
        const rawTitle = link.find('.instancename').length ? link.find('.instancename').text() : link.text();
        const titleClean = rawTitle.replace(/\s+/g, ' ').replace(/\s*(Задание|Тест|Файл|Страница|Форум|Папка|Опрос)$/i, '').trim();

        if (!titleClean && !actUrl) return;

        const classNames = act.attr('class') || '';
        const iconAlt = act.find('img.activityicon').attr('alt') || '';
        const { category, categoryRu } = classifyActivityCategory(classNames, iconAlt, titleClean, actUrl);

        const isCompleted = act.find('.completion-info .autocompletion, .completion-info button').hasClass('completed') ||
          act.find('.completion-info img[src*="completed"]').length > 0;

        const inlineDesc = extractHtmlText($, `${act.attr('id') ? '#' + act.attr('id') : ''} .contentafterlink`);

        items.push({
          id: actId,
          name: titleClean || 'Элемент курса',
          category,
          categoryRu,
          url: actUrl,
          description: inlineDesc || undefined,
          isCompleted,
        });

        totalActivities++;
      });

      sections.push({
        id: secId,
        title,
        summary: summary || undefined,
        items,
      });
    });

    return {
      courseId,
      courseName: courseName || `Курс ${courseId}`,
      sections,
      totalActivities,
    };
  }

  public async getAssignmentDetails(idOrUrl: string | number): Promise<AssignmentDetails> {
    let url = '';
    let assignId = '';

    if (typeof idOrUrl === 'number' || /^\d+$/.test(String(idOrUrl))) {
      assignId = String(idOrUrl);
      url = `${this.baseUrl}/mod/assign/view.php?id=${assignId}`;
    } else {
      url = String(idOrUrl);
      const match = url.match(/id=(\d+)/);
      assignId = match ? match[1] : '';
    }

    const $ = await this.fetchHtml(url);

    const title = $('h2, .page-header-headings h1, [role="main"] h2')
      .first()
      .text()
      .trim();

    const courseName = $('nav.breadcrumb a, .breadcrumb-item a')
      .filter((_, el) => {
        const href = $(el).attr('href') || '';
        return href.includes('/course/view.php');
      })
      .last()
      .text()
      .trim();

    // Main description
    const description = extractHtmlText($, '[role="main"] .box.generalbox, #intro, .activity-description, div.intro');

    // Attached files
    const attachedFiles = extractPluginFiles($, '[role="main"]');

    // Submission table
    const submissionTable: Record<string, string> = {};
    $('table.generaltable tr, table.submissionsummarytable tr').each((_, tr) => {
      const th = $(tr).find('th, td.c0').first().text().replace(/\s+/g, ' ').trim();
      const td = $(tr).find('td.c1, td:last-child').first().text().replace(/\s+/g, ' ').trim();
      if (th && td) {
        submissionTable[th] = td;
      }
    });

    // Check if submit button is available
    const canSubmit = $('form.mform input[type="submit"], a.btn:contains("Добавить ответ"), button:contains("Добавить ответ")').length > 0;

    const submission: SubmissionDetails = {
      status: submissionTable['Состояние ответа'] || submissionTable['Статус ответа'] || 'Не указано',
      gradingStatus: submissionTable['Состояние оценивания'] || submissionTable['Статус оценивания'] || 'Не указано',
      dueDate: submissionTable['Срок сдачи'] || 'Без срока сдачи',
      timeRemaining: submissionTable['Оставшееся время'] || 'Не указано',
      canSubmit,
      lastModified: submissionTable['Последнее изменение'],
      feedback: submissionTable['Отзыв в виде комментариев'] || submissionTable['Комментарии к ответу'],
    };

    const taskClassification = classifyTask(title, description);
    const inPersonDetection = detectInPerson(title, description, canSubmit);

    return {
      id: assignId,
      name: title || 'Задание',
      courseName: courseName || undefined,
      url,
      taskClassification,
      inPersonDetection,
      description,
      attachedFiles,
      submission,
    };
  }

  public async getQuizDetails(idOrUrl: string | number): Promise<QuizDetails> {
    let url = '';
    let quizId = '';

    if (typeof idOrUrl === 'number' || /^\d+$/.test(String(idOrUrl))) {
      quizId = String(idOrUrl);
      url = `${this.baseUrl}/mod/quiz/view.php?id=${quizId}`;
    } else {
      url = String(idOrUrl);
      const match = url.match(/id=(\d+)/);
      quizId = match ? match[1] : '';
    }

    const $ = await this.fetchHtml(url);

    const title = $('h2, .page-header-headings h1, [role="main"] h2')
      .first()
      .text()
      .trim();

    const courseName = $('nav.breadcrumb a, .breadcrumb-item a')
      .filter((_, el) => {
        const href = $(el).attr('href') || '';
        return href.includes('/course/view.php');
      })
      .last()
      .text()
      .trim();

    const description = extractHtmlText($, '[role="main"] #intro, [role="main"] .box.generalbox');

    const statusInfo: string[] = [];
    $('.quizinfo p, .quizinfo, div.box.generalbox.center p').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) statusInfo.push(text);
    });

    let timeLimit: string | undefined;
    let maxAttempts: string | undefined;
    let gradingMethod: string | undefined;

    for (const info of statusInfo) {
      if (/ограничение по времени/i.test(info)) {
        timeLimit = info;
      } else if (/разрешено попыток/i.test(info)) {
        maxAttempts = info;
      } else if (/метод оценивания/i.test(info)) {
        gradingMethod = info;
      }
    }

    const canAttempt = $('input[type="submit"][value*="тест"], input[type="submit"][value*="попытк"], a.btn:contains("тест")').length > 0;

    return {
      id: quizId,
      name: title || 'Тест',
      courseName: courseName || undefined,
      url,
      quizType: /опрос|анкет/i.test(title) ? 'survey' : 'test',
      description,
      timeLimit,
      maxAttempts,
      gradingMethod,
      statusInfo,
      canAttempt,
    };
  }

  public async getResourceContent(idOrUrl: string | number): Promise<ResourceContent> {
    let url = '';
    let resId = '';

    if (typeof idOrUrl === 'number' || /^\d+$/.test(String(idOrUrl))) {
      resId = String(idOrUrl);
      url = `${this.baseUrl}/mod/page/view.php?id=${resId}`;
    } else {
      url = String(idOrUrl);
      const match = url.match(/id=(\d+)/);
      resId = match ? match[1] : '';
    }

    const $ = await this.fetchHtml(url);

    const title = $('h2, .page-header-headings h1, [role="main"] h2')
      .first()
      .text()
      .trim();

    const isFolder = url.includes('/mod/folder/');
    const isResource = url.includes('/mod/resource/');

    const content = extractHtmlText($, '[role="main"] .box.generalbox, [role="main"] #page-content, [role="main"]');
    const files = extractPluginFiles($, '[role="main"]');

    let category: any = 'lecture';
    let categoryRu = 'Лекция / Материал';

    if (isFolder) {
      category = 'folder';
      categoryRu = 'Папка с файлами';
    } else if (isResource) {
      category = files.some(f => f.extension === 'pptx' || f.extension === 'ppt') ? 'presentation' : 'document';
      categoryRu = category === 'presentation' ? 'Презентация' : 'Документ / Файл';
    }

    return {
      id: resId,
      title: title || 'Материал',
      type: category,
      typeRu: categoryRu,
      url,
      content: content || undefined,
      files: files.length > 0 ? files : undefined,
    };
  }

  public async downloadMaterial(fileUrl: string, targetPath: string): Promise<{ success: boolean; filePath: string; sizeBytes: number }> {
    this.ensureAuth();
    const url = fileUrl.startsWith('http') ? fileUrl : `${this.baseUrl}/${fileUrl.replace(/^\/+/, '')}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Cookie: `MoodleSession=${this.moodleSession}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        responseType: 'arraybuffer',
        maxRedirects: 5,
      });

      const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, response.data);

      return {
        success: true,
        filePath: resolvedPath,
        sizeBytes: response.data.length,
      };
    } catch (error) {
      return this.handleAxiosError(error);
    }
  }

  public async getDeadlinesSummary(
    limit: number = 50,
    filter: 'all' | 'overdue' | 'upcoming' = 'all',
    checkInPerson: boolean = true
  ): Promise<DeadlinesSummary> {
    const clampedLimit = Math.max(1, Math.min(50, limit));

    const data = await this.callAjax('core_calendar_get_action_events_by_timesort', {
      timesortfrom: 0,
      limitnum: clampedLimit,
    });

    const events: DeadlineEvent[] = [];
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const oneWeekLater = nowTimestamp + 7 * 24 * 3600;

    for (const e of data?.events || []) {
      const taskClassification = classifyTask(e.name);
      const isOverdue = Boolean(e.overdue || e.timesort < nowTimestamp);

      let inPerson: any = undefined;

      // If requested, inspect the assignment page for in-person detection
      if (checkInPerson && e.url && e.url.includes('/mod/assign/')) {
        try {
          const details = await this.getAssignmentDetails(e.url);
          inPerson = details.inPersonDetection;
        } catch {
          // If assignment page inspection fails, fallback to title heuristic
          inPerson = detectInPerson(e.name, '');
        }
      } else {
        inPerson = detectInPerson(e.name, '');
      }

      events.push({
        id: e.id,
        name: e.name,
        courseName: e.course?.fullname || 'Неизвестный курс',
        dueDate: new Date(e.timesort * 1000).toLocaleString('ru-RU'),
        timestamp: e.timesort,
        isOverdue,
        url: e.url,
        taskType: taskClassification,
        inPerson,
      });
    }

    const overdue = events.filter((e) => e.isOverdue);
    const thisWeek = events.filter((e) => !e.isOverdue && e.timestamp <= oneWeekLater);
    const upcoming = events.filter((e) => !e.isOverdue && e.timestamp > oneWeekLater);

    let filteredEvents = events;
    if (filter === 'overdue') {
      filteredEvents = overdue;
    } else if (filter === 'upcoming') {
      filteredEvents = [...thisWeek, ...upcoming];
    }

    return {
      total: filteredEvents.length,
      overdueCount: overdue.length,
      overdue,
      thisWeek,
      upcoming,
    };
  }

  public async searchCourseMaterials(query: string, courseId?: number): Promise<any[]> {
    const q = query.toLowerCase();
    const results: any[] = [];

    let coursesToSearch: any[] = [];
    if (courseId) {
      coursesToSearch = [{ id: courseId }];
    } else {
      coursesToSearch = await this.getUserCourses('all');
    }

    for (const c of coursesToSearch) {
      try {
        const structure = await this.getCourseStructure(c.id);
        for (const sec of structure.sections) {
          for (const item of sec.items) {
            const matchesTitle = item.name.toLowerCase().includes(q);
            const matchesDesc = item.description?.toLowerCase().includes(q);
            const matchesSec = sec.title.toLowerCase().includes(q);

            if (matchesTitle || matchesDesc || matchesSec) {
              results.push({
                courseId: structure.courseId,
                courseName: structure.courseName,
                sectionTitle: sec.title,
                itemName: item.name,
                category: item.category,
                categoryRu: item.categoryRu,
                url: item.url,
                description: item.description,
              });
            }
          }
        }
      } catch {
        // Skip inaccessible courses
      }
    }

    return results;
  }
}
