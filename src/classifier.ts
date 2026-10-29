import * as cheerio from 'cheerio';
import {
  ActivityCategory,
  AttachedFile,
  ExecutionMode,
  InPersonDetection,
  TaskClassification,
  TaskType,
} from './types.js';

export function classifyTask(title: string, description: string = ''): TaskClassification {
  const combined = `${title} ${description}`.toLowerCase();

  let type: TaskType = 'other';
  let typeRu = 'Другое задание';

  if (/(?:^|\s|\b)(?:к[\.\s]*р|кр)(?:\s|\b|$)|контрольн/i.test(title)) {
    type = 'control_work';
    typeRu = 'Контрольная работа (КР)';
  } else if (/(?:^|\s|\b)(?:п[\.\s]*р|пр)(?:\s|\b|$)|практическ|практикум/i.test(title)) {
    type = 'practical_work';
    typeRu = 'Практическая работа (ПР)';
  } else if (/(?:^|\s|\b)(?:л[\.\s]*р|лр)(?:\s|\b|$)|лабораторн/i.test(title)) {
    type = 'lab_work';
    typeRu = 'Лабораторная работа (ЛР)';
  } else if (/(?:^|\s|\b)(?:д[\.\s]*з|дз)(?:\s|\b|$)|домашн/i.test(title)) {
    type = 'homework';
    typeRu = 'Домашнее задание (ДЗ)';
  } else if (/курсов/i.test(title)) {
    type = 'coursework';
    typeRu = 'Курсовая работа / проект';
  } else if (/(?:^|\s|\b)(?:ргр)(?:\s|\b|$)|расчетно-графическ/i.test(title)) {
    type = 'rgr';
    typeRu = 'Расчетно-графическая работа (РГР)';
  } else if (/тест|опрос|анкет|входной контроль|рубежный контроль|тестирование/i.test(title)) {
    type = 'quiz';
    typeRu = 'Тест / Опрос';
  } else {
    // Check description if title is generic
    if (/(?:^|\s|\b)(?:к[\.\s]*р|кр)(?:\s|\b|$)|контрольн/i.test(combined)) {
      type = 'control_work';
      typeRu = 'Контрольная работа (КР)';
    } else if (/(?:^|\s|\b)(?:п[\.\s]*р|пр)(?:\s|\b|$)|практическ/i.test(combined)) {
      type = 'practical_work';
      typeRu = 'Практическая работа (ПР)';
    } else if (/(?:^|\s|\b)(?:л[\.\s]*р|лр)(?:\s|\b|$)|лабораторн/i.test(combined)) {
      type = 'lab_work';
      typeRu = 'Лабораторная работа (ЛР)';
    } else if (/(?:^|\s|\b)(?:д[\.\s]*з|дз)(?:\s|\b|$)|домашн/i.test(combined)) {
      type = 'homework';
      typeRu = 'Домашнее задание (ДЗ)';
    }
  }

  return {
    type,
    typeRu,
    isControlWork: type === 'control_work',
    isPractical: type === 'practical_work',
    isLab: type === 'lab_work',
    isHomework: type === 'homework',
    isQuiz: type === 'quiz',
  };
}

export function detectInPerson(
  title: string,
  description: string,
  hasSubmissionButton: boolean = true
): InPersonDetection {
  const text = `${title} ${description}`.toLowerCase();
  const reasons: string[] = [];

  if (/в аудитори/i.test(text)) {
    reasons.push("В тексте указано выполнение 'в аудитории'");
  }
  if (/в компьютерном класс/i.test(text)) {
    reasons.push("В тексте указано выполнение 'в компьютерном классе'");
  }
  if (/(?:^|\s|\b)очно(?:\s|\b|$)/i.test(text)) {
    reasons.push("В тексте прямо указан очный формат ('очно')");
  }
  if (/на пар[еах]\b/i.test(text)) {
    reasons.push("В тексте указано выполнение 'на паре'");
  }
  if (/на практическом заняти/i.test(text)) {
    reasons.push("В тексте указано выполнение 'на практическом занятии'");
  }
  if (/на заняти[иях]/i.test(text)) {
    reasons.push("В тексте указано выполнение 'на занятии'");
  }
  if (/сда[её]тся лично|сдать лично|показать преподавателю|сдается преподавателю/i.test(text)) {
    reasons.push("Указана личная сдача преподавателю");
  }
  if (/защита на пар/i.test(text)) {
    reasons.push("Указана защита на паре");
  }
  if (/без сдачи в сдо|в сдо загружать не нужно|в сдо прикреплять не нужно/i.test(text)) {
    reasons.push("Указано, что в СДО загружать не требуется");
  }

  const hasKeywords = reasons.length > 0;
  let isInPerson = false;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let mode: ExecutionMode = 'unknown';

  if (hasKeywords) {
    isInPerson = true;
    mode = 'in_person';
    if (!hasSubmissionButton || /в аудитори|очно|без сдачи/i.test(text)) {
      confidence = 'high';
    } else {
      confidence = 'medium';
    }
  } else if (!hasSubmissionButton) {
    mode = 'unknown';
    confidence = 'low';
  } else {
    mode = 'remote';
    confidence = 'medium';
  }

  return {
    isInPerson,
    mode,
    modeRu: isInPerson ? 'Очно (в аудитории)' : mode === 'remote' ? 'Дистанционно (в СДО)' : 'Не определено',
    confidence,
    reasons,
  };
}

export function classifyActivityCategory(
  className: string = '',
  iconAlt: string = '',
  title: string = '',
  url: string = ''
): { category: ActivityCategory; categoryRu: string } {
  const cls = className.toLowerCase();
  const alt = iconAlt.toLowerCase();
  const t = title.toLowerCase();

  if (cls.includes('modtype_assign') || alt.includes('задание')) {
    return { category: 'assignment', categoryRu: 'Задание / ДЗ / ПР' };
  }
  if (cls.includes('modtype_quiz') || alt.includes('тест')) {
    return { category: 'quiz', categoryRu: 'Тест' };
  }
  if (cls.includes('modtype_feedback') || cls.includes('modtype_choice') || alt.includes('опрос') || alt.includes('анкет')) {
    return { category: 'survey', categoryRu: 'Опрос / Анкета' };
  }
  if (cls.includes('modtype_page') || alt.includes('страница')) {
    return { category: 'lecture', categoryRu: 'Лекция / Материал' };
  }
  if (cls.includes('modtype_folder') || alt.includes('папка')) {
    return { category: 'folder', categoryRu: 'Папка с файлами' };
  }
  if (cls.includes('modtype_url') || alt.includes('гиперссылка') || alt.includes('ссылка')) {
    return { category: 'link', categoryRu: 'Ссылка' };
  }
  if (cls.includes('modtype_forum') || alt.includes('форум')) {
    return { category: 'forum', categoryRu: 'Форум' };
  }
  if (cls.includes('modtype_resource') || alt.includes('файл') || alt.includes('документ')) {
    if (t.includes('презентац') || url.includes('.pptx') || url.includes('.ppt')) {
      return { category: 'presentation', categoryRu: 'Презентация' };
    }
    if (t.includes('лекци')) {
      return { category: 'lecture', categoryRu: 'Лекция' };
    }
    return { category: 'document', categoryRu: 'Документ / Файл' };
  }

  // Fallback by title
  if (t.includes('презентац')) return { category: 'presentation', categoryRu: 'Презентация' };
  if (t.includes('лекци')) return { category: 'lecture', categoryRu: 'Лекция' };
  if (t.includes('тест')) return { category: 'quiz', categoryRu: 'Тест' };
  if (t.includes('опрос') || t.includes('анкет')) return { category: 'survey', categoryRu: 'Опрос' };
  if (t.includes('практическ') || t.includes('лабораторн') || t.includes('контрольн')) {
    return { category: 'assignment', categoryRu: 'Задание' };
  }

  return { category: 'other', categoryRu: 'Ресурс' };
}

export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function extractHtmlText($: cheerio.CheerioAPI, selector: string): string {
  const el = $(selector);
  if (!el.length) return '';

  // Remove unwanted elements
  el.find('script, style, noscript, svg, .accesshide, .sr-only').remove();

  // Convert br and block elements to newlines
  el.find('br').replaceWith('\n');
  el.find('p, div, h1, h2, h3, h4, h5, h6, li, tr').each((_, elem) => {
    $(elem).append('\n');
  });

  return cleanText(el.text());
}

export function extractPluginFiles($: cheerio.CheerioAPI, containerSelector: string): AttachedFile[] {
  const files: AttachedFile[] = [];
  const container = $(containerSelector);

  container.find('a[href*="pluginfile.php"], a[href*="/mod/resource/"], a[href*="forcedownload=1"]').each((_, el) => {
    const link = $(el);
    let href = link.attr('href') || '';
    let name = link.text().replace(/\s+/g, ' ').trim();

    if (!href) return;

    // Decode URL to extract filename if text is generic
    try {
      const decoded = decodeURIComponent(href);
      const urlFileName = decoded.split('/').pop()?.split('?')[0] || '';
      if (!name || name === 'Скачать' || name === 'Download' || name.length < 3) {
        name = urlFileName || name;
      }
    } catch {
      // ignore uri decode error
    }

    const extMatch = (name || href).match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
    const extension = extMatch ? extMatch[1].toLowerCase() : '';

    // Avoid duplicates
    if (!files.some(f => f.url === href)) {
      files.push({ name: name || 'Файл', url: href, extension });
    }
  });

  return files;
}
