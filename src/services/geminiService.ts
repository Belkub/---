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

export const analyzeBentonite = async (
  input: string | { data: string; mimeType: string },
  crossing?: CrossingParams
) => {
  const model = "gemini-3.1-pro-preview";
  
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

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
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
    }
  });

  try {
    let textResponse = "";
    try {
      textResponse = response.text || "";
    } catch (e) {
      console.error("Error accessing response.text:", e);
    }

    if (!textResponse) {
      return { text: "Информация не найдена или заблокирована фильтрами безопасности.", brand: typeof input === 'string' ? input : "" };
    }

    // Try to extract JSON if the model included extra text
    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(textResponse);

    return {
      text: result.analysis || "Информация не найдена.",
      brand: result.brand || (typeof input === 'string' ? input : "")
    };
  } catch (e) {
    console.error("Parsing error in analyzeBentonite:", e);
    return {
      text: "Произошла ошибка при обработке данных. Пожалуйста, попробуйте уточнить запрос.",
      brand: typeof input === 'string' ? input : ""
    };
  }
};

export const getBentoniteComposition = async (brand: string) => {
  const model = "gemini-3.1-pro-preview";
  
  const prompt = `Предоставьте подробный предполагаемый состав бентопорошка марки: ${brand}.
  
  Включите следующие разделы:
  1. Тип и природа бентонита (например, натриевый, кальциевый, активированный, месторождение).
  2. Тип и природа присадок:
     - Полимерные добавки (тип полимера, назначение).
     - Неорганические присадки (сода, соли и др.).
     - Другие функциональные компоненты.
  
  Ответ должен быть на русском языке, без LaTeX-символов. Используйте четкую структуру.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction: `Вы эксперт в области химии буровых растворов и минералогии. Ваша задача — предоставлять ИСКЛЮЧИТЕЛЬНО ДОСТОВЕРНУЮ техническую информацию.

КРИТИЧЕСКИЕ ПРАВИЛА:
1. ИНФОРМАЦИЯ О ПРОИЗВОДИТЕЛЕ: Указывайте только реально существующие адреса и контакты. Обязательно в скобках указывайте источник: (источник: [URL]).
2. ПРОВЕРКА ССЫЛОК: Каждая ссылка должна быть ПРЯМОЙ ссылкой на официальный сайт. ЗАПРЕЩЕНО давать ссылки на результаты поиска.
3. ПРОВЕРКА ДАННЫХ: Если данных нет на официальных сайтах — НЕ ВЫДУМЫВАЙТЕ ИХ. Пишите "Данные не найдены".
4. АББРЕВИАТУРЫ: ЗАПРЕЩЕНО придумывать расшифровки.
5. СТРУКТУРА: Отчет должен быть СТРОГО структурирован с пустыми строками между разделами.
6. ПРЕДУПРЕЖДЕНИЕ: Достоверность — единственный приоритет. Ответ на русском языке.`
    }
  });

  return response.text;
};

export const getBentoniteAnalogs = async (brand: string) => {
  const model = "gemini-3.1-pro-preview";
  
  const prompt = `Найдите список всех известных марок/брендов бентопорошков (как российского, так и зарубежного производства), которые являются прямыми технологическими аналогами марки: ${brand}.
  
  Критерии подбора аналогов:
  - Близкие показатели вязкости (марша, эффективной).
  - Схожая реология (предел текучести, СНС).
  - Аналогичная водоотдача и толщина корки.
  - Схожее назначение (для каких типов грунтов и условий переходов).
  
  ПРАВИЛА ПРОВЕРКИ И ВЫВОДА (КРИТИЧЕСКИ ВАЖНО):
  1. В аналогах должны быть только марки бентопорошков, позиционируемых именно для ГНБ (HDD).
  2. ПЕРЕД ТЕМ КАК ДОБАВИТЬ МАРКУ В СПИСОК, ОБЯЗАТЕЛЬНО ПРОВЕРЬТЕ ЕЁ СУЩЕСТВОВАНИЕ И ХАРАКТЕРИСТИКИ ЧЕРЕЗ ПОИСК.
  3. ДЛЯ КАЖДОГО АНАЛОГА ОБЯЗАТЕЛЬНО В СКОБКАХ УКАЗЫВАЙТЕ ПРЯМУЮ ССЫЛКУ НА СТРАНИЦУ ПРОДУКТА ИЛИ ТЕХНИЧЕСКОЕ ОПИСАНИЕ (TDS) НА ОФИЦИАЛЬНОМ САЙТЕ (например: (источник: https://...)).
  4. ЕСЛИ ВЫ НЕ НАШЛИ ПОДТВЕРЖДЕНИЯ СУЩЕСТВОВАНИЯ МАРКИ ИЛИ АКТИВНУЮ ССЫЛКУ НА ОФИЦИАЛЬНОМ САЙТЕ — НЕ ВКЛЮЧАЙТЕ ЕЁ.
  5. ЗАПРЕЩЕНО ВЫДУМЫВАТЬ НАЗВАНИЯ МАРОК, ИХ ХАРАКТЕРИСТИКИ ИЛИ ССЫЛКИ.
  6. ЛУЧШЕ ВЫДАТЬ 2-3 РЕАЛЬНЫХ АНАЛОГА С РАБОЧИМИ ССЫЛКАМИ, ЧЕМ 10 ВЫМЫШЛЕННЫХ.
  
  Для каждой аналогичной марки предоставьте:
  1. Название марки.
  2. Краткое сравнение ключевых свойств с оригиналом (вязкость, реология).
  3. Ссылку на источник в скобках.
  
  КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО указывать названия производителей, их телефоны или сайты (кроме ссылки на страницу продукта). Ответ должен быть на русском языке, структурирован как список. Не используйте LaTeX.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction: `Вы эксперт-технолог по буровым растворам ГНБ. Ваша задача — подобрать аналоги бентонита.

КРИТИЧЕСКИЕ ПРАВИЛА:
1. ТОЛЬКО ГНБ: В аналогах должны быть только марки бентопорошков, позиционируемых именно для ГНБ (HDD).
2. ПРОВЕРКА ССЫЛОК: Для каждого аналога ОБЯЗАТЕЛЬНА прямая ссылка на страницу продукта или TDS на официальном сайте. 
   - ЗАПРЕЩЕНО выдумывать ссылки. Ссылки должны быть активными и вести на реально существующие сайты.
   - ЗАПРЕЩЕНО давать ссылки на результаты поиска.
3. ПРОВЕРКА ДАННЫХ: Если информация не найдена на официальных ресурсах — не выводите её.
4. СТРУКТУРА: Отчет должен быть СТРОГО структурирован с пустыми строками между разделами.
5. АББРЕВИАТУРЫ: ЗАПРЕЩЕНО придумывать расшифровки.
6. ПРЕДУПРЕЖДЕНИЕ: Достоверность — единственный приоритет. Ответ на русском языке.`
    }
  });

  return response.text;
};

export const getWaterTreatment = async (params: WaterParams) => {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Based on these water parameters for HDD drilling fluid preparation:
  - Temperature: ${params.temperature}°C
  - Conductivity: ${params.conductivity} µS/cm
  - pH: ${params.ph}
  - Total Hardness: ${params.hardness} ppm (mg/l)
  
  Provide 3 levels of water treatment recipes:
  1. Economy (Cheapest, technologically acceptable)
  2. Standard (Balanced)
  3. Premium (Solves all problems, optimal quality)
  
  For each level, list reagents (like Soda Ash, Citric Acid, Sodium Percarbonate, Caustic Soda, TPP, HMP), their concentrations, and the logic behind the choice. Respond in Russian.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: "Вы профессиональный инженер по буровым растворам ГНБ. Ваша цель — предоставить точные рецепты химической обработки для оптимизации воды. ВАЖНО: Не используйте LaTeX-символы или сложные математические обозначения. Пишите названия параметров словами, используйте только стандартные системные единицы (м3, м, мм, кг, г, л). Ответ должен быть на русском языке."
    }
  });

  return response.text;
};
