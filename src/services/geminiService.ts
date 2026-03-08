import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const getApiKey = () => {
  return (import.meta as any).env?.VITE_GEMINI_API_KEY || 
         (process as any).env?.GEMINI_API_KEY || 
         (process as any).env?.VITE_GEMINI_API_KEY;
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

export interface BentoniteInfo {
  brand: string;
  properties: string;
  recommendations: string;
  optimalWater: string;
}

export interface WaterParams {
  temperature: number;
  conductivity: number;
  ph: number;
  hardness: number;
}

export interface Recipe {
  level: 'Economy' | 'Standard' | 'Premium';
  description: string;
  reagents: { name: string; dosage: string; purpose: string }[];
  costEstimate: string;
}

export interface CrossingParams {
  length: number;
  reamerDiameter: number;
  soilType: string;
}

const isRetryableError = (error: any): { retryable: boolean; type: 'quota' | 'high_demand' | 'other' } => {
  const errorMessage = String(error.message || "").toLowerCase();
  const errorStatus = String(error.status || "").toUpperCase();
  const errorDetails = JSON.stringify(error).toLowerCase();
  
  const isQuota = 
    errorMessage.includes("429") || 
    errorMessage.includes("resource_exhausted") ||
    errorStatus === "RESOURCE_EXHAUSTED" ||
    errorDetails.includes("429") ||
    errorDetails.includes("resource_exhausted") ||
    (error.response && error.response.status === 429);

  if (isQuota) return { retryable: true, type: 'quota' };

  const isHighDemand = 
    errorMessage.includes("503") ||
    errorMessage.includes("high demand") ||
    errorMessage.includes("service unavailable") ||
    errorMessage.includes("overloaded") ||
    errorMessage.includes("deadline exceeded") ||
    errorStatus === "SERVICE_UNAVAILABLE" ||
    errorStatus === "DEADLINE_EXCEEDED" ||
    errorDetails.includes("503") ||
    errorDetails.includes("high demand") ||
    errorDetails.includes("overloaded") ||
    errorDetails.includes("deadline exceeded") ||
    (error.response && error.response.status === 503);

  if (isHighDemand) return { retryable: true, type: 'high_demand' };

  return { retryable: false, type: 'other' };
};

const callGemini = async (model: string, contents: any, config: any, signal?: AbortSignal, retries = 6) => {
  const TIMEOUT = 60000;
  let retryCount = 0;
  
  while (retryCount <= retries) {
    if (signal?.aborted) throw new Error("Request aborted");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);
    
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const currentConfig = { 
        temperature: 0,
        seed: 42,
        ...config 
      };
      
      if (retryCount > 0 && currentConfig.tools) {
        delete currentConfig.tools;
      }

      const response = await ai.models.generateContent({ 
        model, 
        contents, 
        config: currentConfig
      });
      
      clearTimeout(timeoutId);
      let text = response.text || "";
      return { ...response, text };
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        if (signal?.aborted) throw error;
        if (retryCount < retries) {
          retryCount++;
          const delay = 1000 * retryCount + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error("Превышено время ожидания ответа (60 сек). Пожалуйста, попробуйте еще раз.");
      }

      const errorInfo = isRetryableError(error);
      if (errorInfo.retryable && retryCount < retries) {
        retryCount++;
        const baseDelay = errorInfo.type === 'quota' ? 15000 : (errorInfo.type === 'high_demand' ? 5000 : 2000);
        const delay = Math.pow(2, retryCount) * baseDelay + Math.random() * 3000;
        
        console.warn(`Retryable error (${errorInfo.type}). Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (errorInfo.retryable) {
        if (errorInfo.type === 'high_demand') {
          throw new Error("Сервер Gemini перегружен. Пожалуйста, подождите 5-10 секунд.");
        }
        throw new Error("Лимит запросов исчерпан. Пожалуйста, подождите 1 минуту.");
      }
      
      if (error.message?.includes("API key not valid")) {
        throw new Error("Неверный API ключ.");
      }

      throw error;
    }
  }
  throw new Error("Не удалось получить ответ от нейросети после нескольких попыток.");
};

const ANTI_HALLUCINATION_RULES = `
КРИТИЧЕСКИЕ ПРАВИЛА ВАЛИДАЦИИ:
1. Если на входе ИЗОБРАЖЕНИЕ и на нем нет бентонита -> "Ошибка ввода данных: изображение не распознано."
2. Если на входе ТЕКСТ и это не марка бентонита -> "Ошибка ввода данных: марка не идентифицирована."
3. ЗАПРЕЩЕНО путать типы ввода.
`;

const SYSTEM_INSTRUCTION_BASE = `Вы — инженер ГНБ. Ваша задача: быстрый и точный тех-анализ бентонита.

ПРАВИЛА:
1. СТРУКТУРА: 4-6 кратких абзацев. Разделяйте абзацы \\n\\n.
2. ЗАГОЛОВОК: Начните с "## Название_Марки".
3. РАСЧЕТЫ: Используйте стандартные концентрации (Песок: 25кг/м3, Глина: 15кг/м3). 
4. ФОРМУЛА ОБЪЕМА: V = L * 3.14 * (D/2000)^2 * K. Покажите расчет пошагово.
5. ЗАПРЕТЫ: Без LaTeX, без контактов, без внутренних размышлений.
6. СКОРОСТЬ: Пишите по существу, без лишних вступлений.`;

const SYSTEM_INSTRUCTION_TEXT = `${SYSTEM_INSTRUCTION_BASE}

КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ ТЕКСТОВОГО ВВОДА:
1. Вам дано ТЕКСТОВОЕ НАЗВАНИЕ марки.
2. ЗАПРЕЩЕНО упоминать изображения, фото или ошибки распознавания картинок.
3. Если марка не найдена в базе ГНБ -> выведите ТОЛЬКО: "Ошибка ввода данных: марка не идентифицирована."
4. Используйте Google Search для подтверждения существования марки.`;

const SYSTEM_INSTRUCTION_IMAGE = `${SYSTEM_INSTRUCTION_BASE}

КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ ФОТО:
1. Вам дано ИЗОБРАЖЕНИЕ (фото этикетки).
2. Если на фото нет бентонита или текст не читаем -> выведите ТОЛЬКО: "Ошибка ввода данных: изображение не распознано."
3. Распознайте марку и проведите анализ.`;

const stripMetaText = (text: string) => {
  if (!text) return "";
  const headerIndex = text.indexOf('##');
  if (headerIndex !== -1) {
    return text.substring(headerIndex);
  }
  return text;
};

export const analyzeBentoniteStream = async (
  input: string | { data: string; mimeType: string },
  crossing: CrossingParams | undefined,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  retries = 6
) => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API ключ не настроен.");

  const model = "gemini-3-flash-preview";
  
  let crossingInfo = "";
  if (crossing) {
    crossingInfo = `
    ДАННЫЕ ДЛЯ ТЕХНИЧЕСКОГО РАСЧЕТА:
    - Длина перехода: ${crossing.length} м
    - Диаметр расширителя: ${crossing.reamerDiameter} мм
    - Тип грунта: ${crossing.soilType}
    
    ТРЕБУЕМЫЕ РАСЧЕТЫ (ОБЯЗАТЕЛЬНО):
    1. Концентрация бентонита (кг/м3).
    2. Добавки и их дозировки.
    3. Объем раствора V = L * 3.14 * (D/2000)^2 * K.
       Примите K: Песок (3-5), Глина (1.5-2), Суглинок (2-3).
    4. Итоговый расход материалов.
    `;
  }

  const contents = typeof input === 'string' 
    ? { parts: [{ text: `ИНСТРУКЦИЯ: Проведите анализ бентонита по ТЕКСТОВОМУ НАЗВАНИЮ. \nМАРКА: "${input}". \n\n${crossingInfo}` }] }
    : {
        parts: [
          { inlineData: input },
          { text: `ИНСТРУКЦИЯ: Распознайте марку на ФОТО ЭТИКЕТКИ и проведите анализ. \n\n${crossingInfo}` }
        ]
      };

  let retryCount = 0;
  while (retryCount <= retries) {
    try {
      const currentConfig: any = {
        temperature: 0,
        seed: 42,
        tools: retryCount === 0 ? [{ googleSearch: {} }] : [],
        systemInstruction: typeof input === 'string' ? SYSTEM_INSTRUCTION_TEXT : SYSTEM_INSTRUCTION_IMAGE
      };

      const responseStream = await ai.models.generateContentStream({
        model,
        contents,
        config: currentConfig
      });

      let fullText = "";
      for await (const chunk of responseStream) {
        if (signal?.aborted) throw new Error("Request aborted");
        let text = chunk.text || "";
        
        // Anti-hallucination hack: check for specific error phrases
        const lowerText = text.toLowerCase();
        const lowerFull = fullText.toLowerCase();
        
        // If it's text input but model mentions image recognition errors
        if (typeof input === 'string' && (
          lowerText.includes("изображение") || 
          lowerFull.includes("изображение") ||
          lowerText.includes("фото") ||
          lowerFull.includes("фото") ||
          lowerText.includes("распознано") ||
          lowerFull.includes("распознано")
        )) {
           // If it's an error message, we replace it
           if (lowerText.includes("ошибка") || lowerFull.includes("ошибка")) {
             fullText = "Ошибка ввода данных: марка не идентифицирована в базе ГНБ.";
             onChunk(fullText);
             return { text: fullText, brand: "" };
           }
        }

        fullText += text;
        onChunk(stripMetaText(fullText));
      }

      if (fullText.includes("Ошибка ввода данных")) {
        return { text: fullText, brand: "" };
      }

      const brandMatch = fullText.match(/^##\s*(.*?)\n/) || fullText.match(/Бренд:\s*(.*?)\n/) || fullText.match(/Марка:\s*(.*?)\n/);
      return { 
        text: stripMetaText(fullText), 
        brand: brandMatch ? brandMatch[1].trim() : (typeof input === 'string' ? input : "") 
      };
    } catch (error: any) {
      if (signal?.aborted) throw error;
      
      const errorInfo = isRetryableError(error);
      if (errorInfo.retryable && retryCount < retries) {
        retryCount++;
        const baseDelay = errorInfo.type === 'quota' ? 15000 : (errorInfo.type === 'high_demand' ? 5000 : 2000);
        const delay = Math.pow(2, retryCount) * baseDelay + Math.random() * 3000;
        
        console.warn(`Retryable error in stream (${errorInfo.type}). Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (errorInfo.retryable) {
        if (errorInfo.type === 'high_demand') {
          throw new Error("Сервер Gemini перегружен. Пожалуйста, подождите 5-10 секунд.");
        }
        throw new Error("Лимит запросов исчерпан. Пожалуйста, подождите 1 минуту.");
      }

      throw error;
    }
  }
  throw new Error("Не удалось получить ответ от нейросети после нескольких попыток.");
};

export const analyzeBentonite = async (
  input: string | { data: string; mimeType: string },
  crossing?: CrossingParams,
  signal?: AbortSignal
) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { text: "Ошибка: API ключ не настроен.", brand: "" };
  }

  const model = "gemini-3-flash-preview";
  
  let crossingInfo = "";
  if (crossing) {
    crossingInfo = `
    ДАННЫЕ ДЛЯ ТЕХНИЧЕСКОГО РАСЧЕТА:
    - Длина перехода: ${crossing.length} м
    - Диаметр расширителя: ${crossing.reamerDiameter} мм
    - Тип грунта: ${crossing.soilType}
    
    ТРЕБУЕМЫЕ РАСЧЕТЫ (ОБЯЗАТЕЛЬНО):
    1. Концентрация бентонита (кг/м3).
    2. Добавки и их дозировки.
    3. Объем раствора V = L * 3.14 * (D/2000)^2 * K.
       Примите K: Песок (3-5), Глина (1.5-2), Суглинок (2-3).
    4. Итоговый расход материалов.
    `;
  }

  const contents = typeof input === 'string' 
    ? { parts: [{ text: `ИНСТРУКЦИЯ: Проведите анализ бентонита по ТЕКСТОВОМУ НАЗВАНИЮ. \nМАРКА: "${input}". \n\n${crossingInfo}` }] }
    : {
        parts: [
          { inlineData: input },
          { text: `ИНСТРУКЦИЯ: Распознайте марку на ФОТО ЭТИКЕТКИ и проведите анализ. \n\n${crossingInfo}` }
        ]
      };

  try {
      const response = await callGemini(model, contents, {
      tools: [{ googleSearch: {} }],
      seed: 42,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          brand: { type: Type.STRING, description: "Identified brand name" },
          error: { type: Type.STRING, description: "Validation error message if input is invalid" },
          analysisParagraphs: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Technical analysis broken into 4-6 detailed semantic paragraphs." 
          }
        },
        required: []
      },
      systemInstruction: typeof input === 'string' ? SYSTEM_INSTRUCTION_TEXT : SYSTEM_INSTRUCTION_IMAGE
    }, signal);

    let textResponse = response.text || "";
    const jsonMatch = textResponse.match(/\\{[\\s\\S]*\\}/);
    let result: any = { analysisParagraphs: [], brand: "", error: "" };
    
    try {
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(textResponse);
    } catch (e) {
      if (textResponse.includes("Ошибка ввода данных")) {
        return { text: textResponse, brand: "" };
      }
      result.analysisParagraphs = [textResponse];
    }

    if (result.error) {
      return { text: result.error, brand: "" };
    }

    const finalAnalysis = Array.isArray(result.analysisParagraphs) 
      ? result.analysisParagraphs.join("\\n\\n") 
      : (result.analysis || "Информация не найдена.");

    const strippedAnalysis = stripMetaText(finalAnalysis);

    return {
      text: strippedAnalysis || "Информация не найдена.",
      brand: result.brand || (typeof input === 'string' ? input : "")
    };
  } catch (error: any) {
    return {
      text: `Ошибка: ${error.message || "Неизвестная ошибка"}`,
      brand: typeof input === 'string' ? input : ""
    };
  }
};

export const getBentoniteComposition = async (brand: string, signal?: AbortSignal) => {
  const apiKey = getApiKey();
  if (!apiKey) return "Ошибка: API ключ не настроен.";

  const model = "gemini-3-flash-preview";
  
  const prompt = `Предоставьте подробный технический состав и химико-физические показатели бентопорошка марки: ${brand}.
  
  Требования к ответу:
  1. ВАЛИДАЦИЯ: Если марку невозможно идентифицировать как реально существующий бентонит для ГНБ, выведите ТОЛЬКО: "Ошибка ввода данных: марка бентонита не идентифицирована. Пожалуйста, проверьте правильность написания."
  2. Укажите минеральный состав (содержание монтмориллонита и др.).
  3. Укажите химический состав (оксиды металлов и др.).
  4. Укажите физические свойства (выход раствора, фильтрация, вязкость и др.).
  5. Ссылки на сайты производителей указывайте ТОЛЬКО в скобках рядом с названием компании или продукта.
  6. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО указывать телефоны, email и адреса.
  7. Если точные данные не найдены — пишите "Официальные данные не найдены". ЗАПРЕЩЕНО ПРИДУМЫВАТЬ ЦИФРЫ.
  
  Ответ должен быть на русском языке, разбит на 4-6 четких смысловых абзацев. Разделяйте абзацы двойным переносом строки. Используйте ## для заголовков.`;

  try {
    const response = await callGemini(model, prompt, {
      tools: [{ googleSearch: {} }],
      seed: 42,
      systemInstruction: `Вы ведущий эксперт-минералог и технолог буровых растворов. Ваша задача — предоставлять ИСКЛЮЧИТЕЛЬНО ДОСТОВЕРНУЮ техническую информацию.
      
      ${ANTI_HALLUCINATION_RULES}

      ПРАВИЛА ВЫСШЕЙ ЗАЩИТЫ:
      - НИКАКИХ контактных данных (телефоны, email, адреса).
      - Ссылки на сайты производителей — только в скобках рядом с названием.
      - НУЛЕВАЯ ТОЛЕРАНТНОСТЬ К ГАЛЛЮЦИНАЦИЯМ. Если данных нет в официальных TDS — пишите "Данные не найдены".
      - Используйте Markdown. ОБЯЗАТЕЛЬНО разделяйте текст на логические смысловые абзацы ДВОЙНЫМ переносом строки.
      - Категорически запрещено использовать LaTeX-символы.
      - Ответ на русском языке.
      - ЗАПРЕТ ВНУТРЕННИХ МЫСЛЕЙ: Не выводите "start_thought", поисковые запросы или любые другие мета-данные. Только финальный текст.`
    }, signal);

    return stripMetaText(response.text);
  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    return `Ошибка: ${error.message || "Неизвестная ошибка"}`;
  }
};

export const getBentoniteAnalogs = async (brand: string, signal?: AbortSignal) => {
  const apiKey = getApiKey();
  if (!apiKey) return "Ошибка: API ключ не настроен.";

  const model = "gemini-3-flash-preview";
  
  const prompt = `Найдите список марок бентопорошков, которые являются прямыми технологическими аналогами марки: ${brand} для применения в ГНБ.
  
  Требования к ответу:
  1. ВАЛИДАЦИЯ: Если марку невозможно идентифицировать как реально существующий бентонит для ГНБ, выведите ТОЛЬКО: "Ошибка ввода данных: марка бентонита не идентифицирована. Пожалуйста, проверьте правильность написания."
  2. Только реально существующие марки для ГНБ.
  3. Ссылки на сайты производителей указывайте ТОЛЬКО в скобках рядом с названием.
  4. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО указывать телефоны, email и адреса.
  5. Кратко поясните сходство характеристик.
  6. Если аналогов не найдено — напишите "Достоверных аналогов не найдено".
  
  Ответ должен быть на русском языке, разбит на смысловые абзацы (по одному на каждый аналог или группу). Разделяйте абзацы двойным переносом строки.`;

  try {
    const response = await callGemini(model, prompt, {
      tools: [{ googleSearch: {} }],
      seed: 42,
      systemInstruction: `Вы эксперт-технолог по буровым растворам ГНБ. Ваша задача — подобрать аналоги бентонита.
      
      ${ANTI_HALLUCINATION_RULES}

      ПРАВИЛА ВЫСШЕЙ ЗАЩИТЫ:
      - НИКАКИХ контактных данных (телефоны, email, адреса).
      - Ссылки на сайты производителей — только в скобках рядом с названием.
      - ТОЛЬКО ДОСТОВЕРНЫЕ МАРКИ. Если нет подтверждения на сайте производителя — не включайте в список.
      - Разбивайте текст на смысловые абзацы ДВОЙНЫМ переносом строки. Используйте Markdown.
      - Категорически запрещено использовать LaTeX-символы.
      - Ответ на русском языке.
      - ЗАПРЕТ ВНУТРЕННИХ МЫСЛЕЙ: Не выводите "start_thought", поисковые запросы или любые другие мета-данные. Только финальный текст.`
    }, signal);

    return stripMetaText(response.text);
  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    return `Ошибка: ${error.message || "Неизвестная ошибка"}`;
  }
};

export const getWaterTreatment = async (params: WaterParams, signal?: AbortSignal) => {
  const apiKey = getApiKey();
  if (!apiKey) return "Ошибка: API ключ не настроен.";

  const model = "gemini-3-flash-preview";
  
  const prompt = `Рассчитайте 3 варианта рецептуры водоподготовки для приготовления бурового раствора ГНБ на основе следующих параметров воды:
  - Температура: ${params.temperature} °C
  - Электропроводность: ${params.conductivity} мкСм/см
  - pH: ${params.ph}
  - Жесткость: ${params.hardness} ppm (мг/л)

  Требуется предоставить 3 уровня решений:
  1. **Эконом**: Минимально необходимая обработка.
  2. **Стандарт**: Оптимальное решение для стабильной работы.
  3. **Премиум**: Максимальная защита и стабильность.

  СТРОГАЯ СТРУКТУРА ДЛЯ КАЖДОГО ВАРИАНТА:
  ### [Название уровня]
  **РЕЦЕПТУРА (на 1 м3 воды):**
  - [Список реагентов и точные дозировки в кг]
  
  **ОБОСНОВАНИЕ:**
  [Краткое техническое обоснование выбора реагентов именно для этих параметров воды].

  Ответ должен быть на русском языке. Разделяйте уровни двойным переносом строки. Не используйте LaTeX.`;

  try {
    const response = await callGemini(model, prompt, {
      seed: 42,
      systemInstruction: "Вы ведущий инженер-технолог по буровым растворам ГНБ. Ваша цель — предоставить точные, практически применимые рецепты химической обработки воды. СТРОГО СОБЛЮДАЙТЕ ФОРМАТ: сначала блок РЕЦЕПТУРА, затем блок ОБОСНОВАНИЕ для каждого уровня. Категорически запрещено использовать LaTeX-символы. Ответ должен быть на русском языке, разбит на четкие смысловые блоки ДВОЙНЫМ переносом строки."
    }, signal);

    return response.text;
  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    return `Ошибка: ${error.message || "Неизвестная ошибка"}`;
  }
};
