export type TaskType =
  | 'control_work'   // Контрольная работа (КР)
  | 'practical_work' // Практическая работа (ПР)
  | 'lab_work'       // Лабораторная работа (ЛР)
  | 'homework'       // Домашнее задание (ДЗ)
  | 'coursework'     // Курсовая работа / проект
  | 'rgr'            // Расчетно-графическая работа (РГР)
  | 'quiz'           // Тест / Опрос
  | 'other';

export type ExecutionMode = 'in_person' | 'remote' | 'unknown';

export interface TaskClassification {
  type: TaskType;
  typeRu: string;
  isControlWork: boolean;
  isPractical: boolean;
  isLab: boolean;
  isHomework: boolean;
  isQuiz: boolean;
}

export interface InPersonDetection {
  isInPerson: boolean;
  mode: ExecutionMode;
  modeRu: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export type ActivityCategory =
  | 'assignment'
  | 'quiz'
  | 'lecture'
  | 'presentation'
  | 'document'
  | 'folder'
  | 'survey'
  | 'link'
  | 'forum'
  | 'other';

export interface AttachedFile {
  name: string;
  url: string;
  extension: string;
}

export interface SubmissionDetails {
  status: string;
  gradingStatus: string;
  dueDate: string;
  timeRemaining: string;
  canSubmit: boolean;
  lastModified?: string;
  feedback?: string;
}

export interface AssignmentDetails {
  id: string;
  name: string;
  courseName?: string;
  url: string;
  taskClassification: TaskClassification;
  inPersonDetection: InPersonDetection;
  description: string;
  attachedFiles: AttachedFile[];
  submission: SubmissionDetails;
}

export interface CourseSectionItem {
  id: string;
  name: string;
  category: ActivityCategory;
  categoryRu: string;
  url: string;
  description?: string;
  isCompleted?: boolean;
}

export interface CourseSection {
  id: string;
  title: string;
  summary?: string;
  items: CourseSectionItem[];
}

export interface CourseStructure {
  courseId: string;
  courseName: string;
  sections: CourseSection[];
  totalActivities: number;
}

export interface QuizDetails {
  id: string;
  name: string;
  courseName?: string;
  url: string;
  quizType: 'test' | 'survey' | 'quiz';
  description: string;
  timeLimit?: string;
  maxAttempts?: string;
  gradingMethod?: string;
  statusInfo?: string[];
  canAttempt: boolean;
}

export interface ResourceContent {
  id: string;
  title: string;
  type: ActivityCategory;
  typeRu: string;
  url: string;
  content?: string;
  files?: AttachedFile[];
  externalUrl?: string;
}

export interface DeadlineEvent {
  id: number;
  name: string;
  courseName: string;
  dueDate: string;
  timestamp: number;
  isOverdue: boolean;
  url: string;
  taskType: TaskClassification;
  inPerson?: InPersonDetection;
}

export interface DeadlinesSummary {
  total: number;
  overdueCount: number;
  overdue: DeadlineEvent[];
  thisWeek: DeadlineEvent[];
  upcoming: DeadlineEvent[];
}
