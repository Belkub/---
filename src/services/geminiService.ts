import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
  const model = "gemini-3-flash-preview";
  
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
      systemInstruction: "Вы эксперт в области ГНБ, микротоннелирования и буровых растворов. Предоставляйте точные технические данные по мировым брендам бентонита. Рассчитывайте расход на основе объема скважины (pi * r^2 * L) и стандартных коэффициентов (от 2:1 до 5:1). ВАЖНО: Не используйте LaTeX-символы. Пишите параметры словами, используйте системные единицы (м3, м, мм, кг, т). ИТОГОВЫЙ РАСЧЕТ (пункт 4) ОБЯЗАТЕЛЬНО представляйте в виде структурированного текстового перечня (списка), а НЕ в виде таблиц. Для каждого материала указывайте: Наименование материала, Концентрацию на 1 м3, Общий расход на проект. Используйте формат: 4.1. Название группы, далее список характеристик с отступами. Ответ должен быть на русском языке."
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
