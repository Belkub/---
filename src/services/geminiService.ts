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

const callGemini = async (model: string, contents: any, config: any, retries = 3) => {
  let retryCount = 0;
  while (retryCount <= retries) {
    try {
      // If we are on a retry, maybe try without tools if they might be causing quota issues
      const currentConfig = { ...config };
      if (retryCount > 0 && currentConfig.tools) {
        console.warn("Retry attempt: removing tools to see if it bypasses quota limits.");
        delete currentConfig.tools;
      }

      const response = await ai.models.generateContent({ model, contents, config: currentConfig });
      return response;
    } catch (error: any) {
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
        throw new Error("Лимит запросов исчерпан. Пожалуйста, подождите 1-2 минуты. Если ошибка повторяется на первом же запросе, возможно, ваш API ключ имеет ограничения на использование инструментов поиска или выбранной модели.");
      }
      
      if (errorMessage.includes("API key not valid")) {
        throw new Error("Неверный API ключ. Проверьте настройки GEMINI_API_KEY в панели управления Vercel.");
      }

      throw error;
    }
  }
  throw new Error("Не удалось получить ответ от нейросети.");
};

export const analyzeBentonite = async (
  input: string | { data: string; mimeType: string },
  crossing?: CrossingParams
) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing!");
    return { text: "Ошибка: API ключ не настроен. Пожалуйста, проверьте переменные окружения.", brand: "" };
  }

  const model = "gemini-3-flash-preview";
  console.log("Analyzing bentonite with model:", model);
  
  let crossingInfo = "";
  if (crossing) {
    crossingInfo = `
    Параметры перехода:
    - Длина: ${crossing.length} м
    - Диаметр расширителя: ${crossing.reamerDiameter} мм
    - Тип грунта: ${crossing.soilType}
    
    На основе этих параметров, пожалуйста, рассчитайте:
    1. Рекомендуемую концентрацию этого бентонита с учетом типа грунта.
    2. Необходимые добавки (полимеры, смазки и т.д.) и их концентрации, специфичные для данного типа грунта.
    3. Общий оценочный объем бурового раствора (используя стандартные коэффициенты безопасности ГНБ для данного грунта).
    4. Общий расчетный расход бентонита (в кг или тоннах) и других реагентов на весь переход.
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
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          brand: { type: Type.STRING, description: "Identified brand name" },
          analysis: { type: Type.STRING, description: "Full technical analysis in Russian" }
        },
        required: ["brand", "analysis"]
      },
      systemInstruction: `Вы эксперт в области ГНБ, микротоннелирования и буровых растворов. Ваша задача — предоставлять ИСКЛЮЧИТЕЛЬНО ДОСТОВЕРНУЮ техническую информацию.

КРИТИЧЕСКИЕ ПРАВИЛА (НАРУШЕНИЕ ЗАПРЕЩЕНО):
1. ПРОВЕРКА ССЫЛОК: Каждая ссылка (URL), которую вы приводите, должна быть ПРЯМОЙ ссылкой на страницу продукта, TDS или официальный сайт производителя. 
   - ПЕРЕД ВЫВОДОМ ССЫЛКИ вы должны быть на 100% уверены, что она активна и ведет на нужный документ.
   - ЗАПРЕЩЕНО давать ссылки на результаты поиска Google, Яндекс или общие каталоги.
   - Если вы не нашли прямую рабочую ссылку — НЕ ПИШИТЕ её и не выводите информацию, которую не можете подтвердить.
2. ИНФОРМАЦИЯ О ПРОИЗВОДИТЕЛЕ: Указывайте только реально существующие адреса и контакты. 
   - Обязательно в скобках указывайте источник: (источник: [URL]).
   - Если данные на официальном сайте отсутствуют — пишите "Информация о контактах производителя не найдена в открытых официальных источниках".
3. АНАЛОГИ: В список аналогов включайте ТОЛЬКО марки, предназначенные для ГНБ (HDD). 
   - Для каждого аналога ОБЯЗАТЕЛЬНА прямая ссылка на его описание на сайте производителя.
   - Если аналог "похож", но вы не нашли его официального подтверждения для ГНБ — НЕ ВКЛЮЧАЙТЕ его.
4. АББРЕВИАТУРЫ: ЗАПРЕЩЕНО додумывать расшифровки. Если точного значения в документации нет — оставляйте как есть.
5. СТРУКТУРА: Отчет должен быть СТРОГО структурирован с пустыми строками между разделами.
6. ПРЕДУПРЕЖДЕНИЕ: Любая выдуманная цифра, ссылка или адрес делает ваш ответ бесполезным и опасным. Лучше выдать "Данные не найдены", чем ложную информацию.
Ответ должен быть на русском языке.`
    });

    console.log("Gemini API response received");

    let textResponse = response.text || "";
    if (!textResponse) {
      return { text: "Информация не найдена или заблокирована фильтрами безопасности.", brand: typeof input === 'string' ? input : "" };
    }

    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(textResponse);

    return {
      text: result.analysis || "Информация не найдена.",
      brand: result.brand || (typeof input === 'string' ? input : "")
    };
  } catch (error: any) {
    console.error("analyzeBentonite failed:", error);
    return {
      text: `Ошибка: ${error.message || "Неизвестная ошибка"}`,
      brand: typeof input === 'string' ? input : ""
    };
  }
};

export const getBentoniteComposition = async (brand: string) => {
  const apiKey = getApiKey();
  if (!apiKey) return "Ошибка: API ключ не настроен.";

  const model = "gemini-3-flash-preview";
  
  const prompt = `Предоставьте подробный предполагаемый состав бентопорошка марки: ${brand}.
...
  Ответ должен быть на русском языке, без LaTeX-символов. Используйте четкую структуру.`;

  try {
    const response = await callGemini(model, prompt, {
      tools: [{ googleSearch: {} }],
      systemInstruction: `Вы эксперт в области химии буровых растворов и минералогии. Ваша задача — предоставлять ИСКЛЮЧИТЕЛЬНО ДОСТОВЕРНУЮ техническую информацию.
...
6. ПРЕДУПРЕЖДЕНИЕ: Достоверность — единственный приоритет. Ответ на русском языке.`
    });

    return response.text;
  } catch (error: any) {
    console.error("getBentoniteComposition failed:", error);
    return `Ошибка: ${error.message || "Неизвестная ошибка"}`;
  }
};

export const getBentoniteAnalogs = async (brand: string) => {
  const apiKey = getApiKey();
  if (!apiKey) return "Ошибка: API ключ не настроен.";

  const model = "gemini-3-flash-preview";
  
  const prompt = `Найдите список всех известных марок/брендов бентопорошков (как российского, так и зарубежного производства), которые являются прямыми технологическими аналогами марки: ${brand}.
...
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО указывать названия производителей, их телефоны или сайты (кроме ссылки на страницу продукта). Ответ должен быть на русском языке, структурирован как список. Не используйте LaTeX.`;

  try {
    const response = await callGemini(model, prompt, {
      tools: [{ googleSearch: {} }],
      systemInstruction: `Вы эксперт-технолог по буровым растворам ГНБ. Ваша задача — подобрать аналоги бентонита.
...
6. ПРЕДУПРЕЖДЕНИЕ: Достоверность — единственный приоритет. Ответ на русском языке.`
    });

    return response.text;
  } catch (error: any) {
    console.error("getBentoniteAnalogs failed:", error);
    return `Ошибка: ${error.message || "Неизвестная ошибка"}`;
  }
};

export const getWaterTreatment = async (params: WaterParams) => {
  const apiKey = getApiKey();
  if (!apiKey) return "Ошибка: API ключ не настроен.";

  const model = "gemini-3-flash-preview";
  
  const prompt = `Based on these water parameters for HDD drilling fluid preparation:
...
  For each level, list reagents (like Soda Ash, Citric Acid, Sodium Percarbonate, Caustic Soda, TPP, HMP), their concentrations, and the logic behind the choice. Respond in Russian.`;

  try {
    const response = await callGemini(model, prompt, {
      systemInstruction: "Вы профессиональный инженер по буровым растворам ГНБ. Ваша цель — предоставить точные рецепты химической обработки для оптимизации воды. ВАЖНО: Не используйте LaTeX-символы или сложные математические обозначения. Пишите названия параметров словами, используйте только стандартные системные единицы (м3, м, мм, кг, г, л). Ответ должен быть на русском языке."
    });

    return response.text;
  } catch (error: any) {
    console.error("getWaterTreatment failed:", error);
    return `Ошибка: ${error.message || "Неизвестная ошибка"}`;
  }
};
