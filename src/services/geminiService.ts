import { GoogleGenAI, Type } from "@google/genai";

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

const callGemini = async (model: string, contents: any, config: any, signal?: AbortSignal, retries = 2) => {
  const TIMEOUT = 45000; // 45 seconds timeout
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
          continue;
        }
        throw new Error("Превышено время ожидания ответа (45 сек). Попробуйте еще раз.");
      }
      const errorMessage = error.message || "";
      const errorStatus = error.status || "";
      const errorDetails = JSON.stringify(error);
      
      const isQuotaError = 
        errorMessage.includes("429") || 
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorStatus === "RESOURCE_EXHAUSTED" ||
        errorDetails.includes("429") ||
        errorDetails.includes("RESOURCE_EXHAUSTED") ||
        (error.response && error.response.status === 429);
      
      if (isQuotaError && retryCount < retries) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`Quota exceeded (429). Retrying in ${delay}ms... (Attempt ${retryCount}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (isQuotaError) {
        throw new Error("Лимит запросов исчерпан. Пожалуйста, подождите 1-2 минуты.");
      }
      
      if (errorMessage.includes("API key not valid")) {
        throw new Error("Неверный API ключ.");
      }

      throw error;
    }
  }
  throw new Error("Не удалось получить ответ от нейросети.");
};

const ANTI_HALLUCINATION_RULES = `
КРИТИЧЕСКИЕ ПРАВИЛА ПРОТИВ ГАЛЛЮЦИНАЦИЙ И ВАЛИДАЦИЯ ВХОДА:
1. ВАЛИДАЦИЯ ИЗОБРАЖЕНИЯ: Если на фото нет этикетки бентонита или текст не относится к бурению, выведите ТОЛЬКО: "Ошибка ввода данных: изображение не распознано как этикетка бентонита или не содержит полезной информации."
2. ВАЛИДАЦИЯ ТЕКСТА: Если текстовый ввод не является названием бентонита или марку невозможно идентифицировать, выведите ТОЛЬКО: "Ошибка ввода данных: марка бентонита не идентифицирована. Пожалуйста, проверьте правильность написания."
3. ПРОВЕРКА СУЩЕСТВОВАНИЯ: Перед тем как упомянуть марку или сайт, вы ОБЯЗАНЫ убедиться в их реальности через поиск. Категорически запрещено выдумывать аббревиатуры (например, ПБН) или домены (например, p-b.ru).
4. ТОЛЬКО ОФИЦИАЛЬНЫЕ ДАННЫЕ: Если поиск не выдает официальный сайт производителя или TDS для конкретной марки, вы ОБЯЗАНЫ написать: "Официальные технические данные для данной марки не найдены". ЗАПРЕЩЕНО ПРИДУМЫВАТЬ АНАЛОГИ.
5. НИКАКИХ ВЫДУМАННЫХ КОМПАНИЙ: Не упоминайте компании, существование которых не подтверждено.
6. ЗАПРЕТ ВНУТРЕННИХ РАССУЖДЕНИЙ: Категорически запрещено выводить в тексте ответа любые внутренние размышления, "мысли вслух", поисковые запросы или технические пометки (например, "start_thought", "Search Queries", "Self-Correction").
`;

const SYSTEM_INSTRUCTION_ANALYSIS = `Вы — высококвалифицированный инженер-технолог по буровым растворам ГНБ. Ваша задача — предоставлять ИСКЛЮЧИТЕЛЬНО ПРОВЕРЕННУЮ информацию.

${ANTI_HALLUCINATION_RULES}

ПРАВИЛА ОБЕСПЕЧЕНИЯ СТРОГОЙ ПОВТОРЯЕМОСТИ И ДОСТОВЕРНОСТИ:
1. ПРИОРИТЕТ ОШИБКИ: Если сработала валидация (пункты 1 или 2 КРИТИЧЕСКИХ ПРАВИЛ), ваш ответ должен состоять ТОЛЬКО из одной строки с текстом ошибки. Никаких заголовков, расчетов или рекомендаций.
2. ИДЕНТИЧНОСТЬ РЕЗУЛЬТАТОВ: При одинаковых входных данных (марка, длина, диаметр, грунт) вы ОБЯЗАНЫ выдавать идентичные расчеты.
3. СТАНДАРТНЫЕ КОНЦЕНТРАЦИИ (кг/м3) ДЛЯ РАСЧЕТОВ:
   - Песок: Бентонит 25, PAC-полимер 1.0.
   - Глина: Бентонит 15, PHPA-полимер 0.5.
   - Суглинок: Бентонит 20, Полимер 0.5.
   - Плывун: Бентонит 40, Полимер 2.0.
   - Мерзлые грунты: Бентонит 30.
   Используйте эти базовые значения, если в официальном TDS марки не указано иное.
4. КАТЕГОРИЧЕСКИЙ ЗАПРЕТ КОНТАКТОВ: Никогда не выводите номера телефонов, email, физические адреса или ссылки на карты. Только название компании.
5. ССЫЛКИ ТОЛЬКО В СКОБКАХ: Ссылки на официальные сайты производителей должны указываться ТОЛЬКО в круглых скобках сразу после названия компании или продукта.
6. СТРУКТУРА И ЧИТАЕМОСТЬ: Ваш ответ должен состоять из 5-8 развернутых смысловых абзацев. Каждый абзац должен быть отделен ДВОЙНЫМ переносом строки (\\n\\n). Используйте ## для заголовков внутри абзацев.
7. ЗАГОЛОВОК ОТЧЕТА: Первой строкой отчета ВСЕГДА должно быть название марки бентонита в формате "## Название_Марки". (Если нет ошибки валидации). ЗАПРЕЩЕНО выводить любой текст, мысли или пометки ДО этого заголовка.
8. ТОЛЬКО ГНБ: Анализируйте применимость строго для горизонтально-направленного бурения.
9. ПРОВЕРКА РАСЧЕТОВ: При расчете объема раствора (V) всегда используйте формулу V = L * 3.14 * R^2 * K. Покажите выбранный коэффициент K и обоснуйте его типом грунта.
10. НИКАКОГО LATEX: Категорически запрещено использовать LaTeX-символы. Пишите формулы и единицы измерения простым текстом.
11. СТРОГИЙ ЯЗЫК: Весь ответ должен быть на русском языке. Никаких английских пояснений, мета-тегов или служебных слов.
12. ЗАПРЕТ ТЕХНИЧЕСКОГО ВЫВОДА: Не выводите информацию о ходе выполнения запроса, поисковых запросах или промежуточных выводах. Только финальный результат.`;

const stripMetaText = (text: string) => {
  // Remove common meta-text patterns that sometimes leak despite instructions
  return text
    .replace(/start_thought[\s\S]*?##/i, '##') // Remove everything before the first header if it contains start_thought
    .replace(/Search Queries:[\s\S]*?##/i, '##')
    .replace(/Self-Correction:[\s\S]*?##/i, '##')
    .replace(/Thinking Process:[\s\S]*?##/i, '##')
    .replace(/^[\s\S]*?##/, '##'); // Be aggressive: ensure it starts with ##
};

export const analyzeBentoniteStream = async (
  input: string | { data: string; mimeType: string },
  crossing: CrossingParams | undefined,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
) => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API ключ не настроен.");

  const model = "gemini-3-flash-preview";
  
  let crossingInfo = "";
  if (crossing) {
    crossingInfo = `
    Параметры перехода:
    - Длина (L): ${crossing.length} м
    - Диаметр расширителя (D): ${crossing.reamerDiameter} мм
    - Тип грунта: ${crossing.soilType}
    
    На основе этих параметров, пожалуйста, рассчитайте:
    1. Рекомендуемую концентрацию этого бентонита (кг/м3) с учетом типа грунта.
    2. Необходимые добавки (полимеры, смазки и т.д.) и их концентрации, специфичные для данного типа грунта.
    3. Общий оценочный объем бурового раствора (V). 
       ИСПОЛЬЗУЙТЕ ФОРМУЛУ: V = L * 3.14 * (D/2000)^2 * K. 
       Где D/2000 — радиус скважины в метрах (D - диаметр расширителя в мм).
       K — коэффициент выноса шлама (безопасности). 
       СПРАВОЧНО ДЛЯ K: Глина K=1.5-2.0, Суглинок K=2.0-3.0, Песок K=3.0-5.0, Плывун K=5.0+.
       ОБЯЗАТЕЛЬНО: 
       - Укажите выбранный коэффициент K и обоснуйте его.
       - Покажите пошаговый расчет: Площадь сечения * Длина * K.
       - Результат в м3.
       - ЗАПРЕЩЕНО использовать LaTeX или спецсимволы. Пишите формулы простым текстом.
    4. Общий расчетный расход бентонита (в кг или тоннах) и других реагентов на весь переход.
    
    Все расчеты должны быть математически точными и воспроизводимыми для одинаковых исходных данных.
    `;
  }

  const contents = typeof input === 'string' 
    ? `Find technical properties and HDD/tunneling application recommendations for bentonite brand: ${input}. ${crossingInfo}`
    : {
        parts: [
          { inlineData: input },
          { text: `Analyze this bentonite label. Identify the brand and provide technical properties. ${crossingInfo}` }
        ]
      };

  const responseStream = await ai.models.generateContentStream({
    model,
    contents,
    config: {
      temperature: 0,
      seed: 42,
      tools: [{ googleSearch: {} }],
      systemInstruction: SYSTEM_INSTRUCTION_ANALYSIS
    }
  });

  let fullText = "";
  for await (const chunk of responseStream) {
    if (signal?.aborted) throw new Error("Request aborted");
    const text = chunk.text || "";
    fullText += text;
    onChunk(stripMetaText(fullText));
  }

  // Если в ответе содержится ошибка валидации, не пытаемся извлечь бренд
  if (fullText.includes("Ошибка ввода данных")) {
    return { text: fullText, brand: "" };
  }

  const brandMatch = fullText.match(/^##\s*(.*?)\n/) || fullText.match(/Бренд:\s*(.*?)\n/) || fullText.match(/Марка:\s*(.*?)\n/);
  return { 
    text: stripMetaText(fullText), 
    brand: brandMatch ? brandMatch[1].trim() : (typeof input === 'string' ? input : "") 
  };
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
    Параметры перехода:
    - Длина (L): ${crossing.length} м
    - Диаметр расширителя (D): ${crossing.reamerDiameter} мм
    - Тип грунта: ${crossing.soilType}
    
    На основе этих параметров, пожалуйста, рассчитайте:
    1. Рекомендуемую концентрацию этого бентонита (кг/м3) с учетом типа грунта.
    2. Необходимые добавки (полимеры, смазки и т.д.) и их концентрации, специфичные для данного типа грунта.
    3. Общий оценочный объем бурового раствора (V). 
       ИСПОЛЬЗУЙТЕ ФОРМУЛУ: V = L * 3.14 * (D/2000)^2 * K. 
       Где D/2000 — радиус скважины в метрах (D - диаметр расширителя в мм).
       K — коэффициент выноса шлама (безопасности). 
       СПРАВОЧНО ДЛЯ K: Глина K=1.5-2.0, Суглинок K=2.0-3.0, Песок K=3.0-5.0, Плывун K=5.0+.
       ОБЯЗАТЕЛЬНО: 
       - Укажите выбранный коэффициент K и обоснуйте его.
       - Покажите пошаговый расчет: Площадь сечения * Длина * K.
       - Результат в м3.
       - ЗАПРЕЩЕНО использовать LaTeX или спецсимволы. Пишите формулы простым текстом.
    4. Общий расчетный расход бентонита (в кг или тоннах) и других реагентов на весь переход.
    
    Все расчеты должны быть математически точными и воспроизводимыми для одинаковых исходных данных.
    `;
  }

  const contents = typeof input === 'string' 
    ? `Find technical properties and HDD/tunneling application recommendations for bentonite brand: ${input}. ${crossingInfo}`
    : {
        parts: [
          { inlineData: input },
          { text: `Analyze this bentonite label. Identify the brand and provide technical properties. ${crossingInfo}` }
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
            description: "Technical analysis broken into 5-8 detailed semantic paragraphs. Each paragraph should be a complete thought." 
          }
        },
        required: []
      },
      systemInstruction: SYSTEM_INSTRUCTION_ANALYSIS
    }, signal);

    let textResponse = response.text || "";
    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
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
      ? result.analysisParagraphs.join("\n\n") 
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
