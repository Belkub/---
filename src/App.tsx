/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  Search, 
  Droplets, 
  Camera, 
  Upload, 
  Info, 
  Thermometer, 
  Zap, 
  FlaskConical, 
  Beaker,
  ChevronRight,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { analyzeBentoniteStream, getWaterTreatment, WaterParams, getBentoniteComposition, getBentoniteAnalogs } from './services/geminiService';

type Tab = 'bentonite' | 'water';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('bentonite');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [result, setResult] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<'analysis' | 'composition' | 'analogs' | 'water'>('analysis');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Bentonite Search State
  const [brandName, setBrandName] = useState('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [crossingParams, setCrossingParams] = useState({
    length: 100,
    reamerDiameter: 300,
    soilType: 'Песок'
  });
  const [customSoil, setCustomSoil] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Water Params State
  const [waterParams, setWaterParams] = useState<WaterParams>({
    temperature: 15,
    conductivity: 400,
    ph: 7.0,
    hardness: 200
  });

  // Removed auto-update analysis effect as per user request

  const soilTypes = [
    'Песок', 'Глины', 'Суглинок', 'Супесь', 
    'Плывуны', 'Мерзлые грунты', 'Глинистый песчаник', 'Свой тип...'
  ];

  const handleBentoniteSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!brandName.trim() || loading) return;
    
    // Abort previous request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setLoadingStep('Поиск информации о бренде...');
    setError(null);
    setResult('');
    setResultTab('analysis');
    setUploadedImageUrl(null);
    
    try {
      const finalSoilType = crossingParams.soilType === 'Свой тип...' ? customSoil : crossingParams.soilType;
      
      const response = await analyzeBentoniteStream(
        brandName, 
        { ...crossingParams, soilType: finalSoilType },
        (chunk) => {
          setResult(chunk);
          if (loadingStep !== 'Формирование отчета...') setLoadingStep('Формирование отчета...');
        },
        abortControllerRef.current?.signal
      );
      
      if (response.text.startsWith("Ошибка:")) {
        setError(response.text);
      } else {
        setResult(response.text || "Информация не найдена.");
        if (response.brand && response.brand !== brandName) setBrandName(response.brand);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || "Не удалось получить информацию о бентоните. Пожалуйста, попробуйте снова.");
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingStep('');
      abortControllerRef.current = null;
    }
  };

  const handleCompositionSearch = async () => {
    if (!brandName.trim()) {
      setError("Сначала введите название марки бентонита.");
      return;
    }
    
    setLoading(true);
    setLoadingStep('Поиск состава...');
    setError(null);
    setResult(null);
    setResultTab('composition');

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const data = await getBentoniteComposition(brandName, abortControllerRef.current.signal);
      if (data.startsWith("Ошибка:")) {
        setError(data);
      } else {
        setResult(data || "Информация о составе не найдена.");
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || "Не удалось получить состав бентонита.");
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingStep('');
      abortControllerRef.current = null;
    }
  };

  const handleAnalogsSearch = async () => {
    if (!brandName.trim()) {
      setError("Сначала введите название марки бентонита.");
      return;
    }
    
    setLoading(true);
    setLoadingStep('Поиск аналогов...');
    setError(null);
    setResult(null);
    setResultTab('analogs');

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const data = await getBentoniteAnalogs(brandName, abortControllerRef.current.signal);
      if (data.startsWith("Ошибка:")) {
        setError(data);
      } else {
        setResult(data || "Аналоги не найдены.");
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || "Не удалось получить список аналогов.");
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingStep('');
      abortControllerRef.current = null;
    }
  };

  const compressImage = (file: File): Promise<{ data: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1024;
          const MAX_HEIGHT = 1024;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve({
            data: dataUrl.split(',')[1],
            mimeType: 'image/jpeg'
          });
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setLoadingStep('Сжатие изображения...');
    setError(null);
    setResult('');
    setResultTab('analysis');
    
    try {
      const compressed = await compressImage(file);
      setUploadedImageUrl(`data:${compressed.mimeType};base64,${compressed.data}`);
      
      setLoadingStep('Распознавание этикетки...');
      const finalSoilType = crossingParams.soilType === 'Свой тип...' ? customSoil : crossingParams.soilType;
      
      const response = await analyzeBentoniteStream(
        compressed, 
        { ...crossingParams, soilType: finalSoilType },
        (chunk) => {
          setResult(chunk);
          if (loadingStep !== 'Анализ технических данных...') setLoadingStep('Анализ технических данных...');
        },
        abortControllerRef.current?.signal
      );
      
      if (response.text.startsWith("Ошибка:")) {
        setError(response.text);
      } else {
        setResult(response.text || "Не удалось проанализировать изображение.");
        if (response.brand) setBrandName(response.brand);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || "Ошибка анализа изображения.");
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingStep('');
      abortControllerRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleWaterTreatment = async () => {
    setLoading(true);
    setLoadingStep('Расчет рецептур...');
    setError(null);
    setResult(null);
    setResultTab('water');

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const data = await getWaterTreatment(waterParams, abortControllerRef.current.signal);
      if (data.startsWith("Ошибка:")) {
        setError(data);
      } else {
        setResult(data || "Рекомендации не сформированы.");
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || "Не удалось сформировать рецепты водоподготовки.");
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingStep('');
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-serif italic tracking-tight">ГНБ Бентонит-Советник</h1>
          <p className="text-xs uppercase tracking-widest opacity-60 font-mono mt-1">Профессиональная система управления буровыми растворами</p>
        </div>
        <div className="flex bg-white border border-[#141414] rounded-none overflow-hidden">
          <button 
            onClick={() => { setActiveTab('bentonite'); setResult(null); setError(null); }}
            className={`px-6 py-2 text-xs uppercase tracking-widest font-mono transition-colors ${activeTab === 'bentonite' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-gray-100'}`}
          >
            Поиск бентонита
          </button>
          <button 
            onClick={() => { setActiveTab('water'); setResult(null); setError(null); }}
            className={`px-6 py-2 text-xs uppercase tracking-widest font-mono transition-colors ${activeTab === 'water' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-gray-100'}`}
          >
            Водоподготовка
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Input Section */}
        <div className="lg:col-span-5 space-y-6">
          <AnimatePresence mode="wait">
            {activeTab === 'bentonite' ? (
              <motion.div 
                key="bentonite-tab"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-white border border-[#141414] p-6 space-y-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
              >
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Поиск по названию марки</label>
                  <form onSubmit={handleBentoniteSearch} className="relative">
                    <input 
                      type="text" 
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                      placeholder="Напр. Bentonite W, Baroid, ПБМА..."
                      className="w-full bg-transparent border-b border-[#141414] py-2 pr-10 focus:outline-none placeholder:opacity-30"
                    />
                    <button type="submit" className="absolute right-0 top-1/2 -translate-y-1/2 hover:scale-110 transition-transform">
                      <Search size={18} />
                    </button>
                  </form>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Длина перехода (м)</label>
                    <input 
                      type="number" 
                      value={crossingParams.length || ''}
                      onChange={(e) => setCrossingParams({...crossingParams, length: e.target.value === '' ? 0 : Number(e.target.value)})}
                      onFocus={(e) => e.target.select()}
                      placeholder="0"
                      className="w-full bg-transparent border-b border-[#141414] py-1 focus:outline-none text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Ø расширителя (мм)</label>
                    <input 
                      type="number" 
                      value={crossingParams.reamerDiameter || ''}
                      onChange={(e) => setCrossingParams({...crossingParams, reamerDiameter: e.target.value === '' ? 0 : Number(e.target.value)})}
                      onFocus={(e) => e.target.select()}
                      placeholder="0"
                      className="w-full bg-transparent border-b border-[#141414] py-1 focus:outline-none text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Тип грунта</label>
                  <select 
                    value={crossingParams.soilType}
                    onChange={(e) => setCrossingParams({...crossingParams, soilType: e.target.value})}
                    className="w-full bg-transparent border-b border-[#141414] py-2 focus:outline-none text-sm appearance-none cursor-pointer"
                  >
                    {soilTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  {crossingParams.soilType === 'Свой тип...' && (
                    <motion.input 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      type="text"
                      value={customSoil}
                      onChange={(e) => setCustomSoil(e.target.value)}
                      placeholder="Введите тип грунта..."
                      className="w-full bg-transparent border-b border-[#141414] py-2 focus:outline-none text-sm mt-2"
                    />
                  )}
                </div>

                <button 
                  onClick={() => handleBentoniteSearch()}
                  disabled={loading || !brandName.trim()}
                  className="w-full bg-[#141414] text-[#E4E3E0] py-3 text-xs uppercase tracking-widest font-mono hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Search size={14} />
                    </motion.div>
                  ) : (
                    <Search size={14} />
                  )}
                  Запустить анализ
                </button>

                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-[#141414] opacity-20"></span>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-mono bg-white px-2">
                    ИЛИ
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Анализ фото этикетки</label>
                  {uploadedImageUrl ? (
                    <div className="space-y-4">
                      <div className="relative border border-[#141414] overflow-hidden group">
                        <img 
                          src={uploadedImageUrl} 
                          alt="Uploaded label" 
                          className="w-full h-48 object-cover grayscale hover:grayscale-0 transition-all duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <button 
                          onClick={() => { setUploadedImageUrl(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                          className="absolute top-2 right-2 bg-white border border-[#141414] p-1 hover:bg-[#141414] hover:text-white transition-colors"
                        >
                          <AlertCircle size={14} className="rotate-45" />
                        </button>
                      </div>
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border border-[#141414] py-2 text-[10px] uppercase tracking-widest font-mono hover:bg-gray-50 transition-colors"
                      >
                        Загрузить другое фото
                      </button>
                    </div>
                  ) : (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-[#141414] p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors group"
                    >
                      <div className="p-3 rounded-full border border-[#141414] group-hover:bg-[#141414] group-hover:text-white transition-colors">
                        <Camera size={24} />
                      </div>
                      <p className="text-xs font-mono uppercase tracking-wider">Нажмите, чтобы загрузить фото</p>
                    </div>
                  )}
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="water-tab"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-white border border-[#141414] p-6 space-y-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
              >
                <h3 className="font-serif italic text-xl">Параметры воды</h3>
                
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono opacity-50">
                      <Thermometer size={12} /> Темп. (°C)
                    </label>
                    <input 
                      type="number" 
                      value={waterParams.temperature || ''}
                      onChange={(e) => setWaterParams({...waterParams, temperature: e.target.value === '' ? 0 : Number(e.target.value)})}
                      onFocus={(e) => e.target.select()}
                      className="w-full bg-transparent border-b border-[#141414] py-1 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono opacity-50">
                      <Zap size={12} /> Пров. (мкСм/см)
                    </label>
                    <input 
                      type="number" 
                      value={waterParams.conductivity || ''}
                      onChange={(e) => setWaterParams({...waterParams, conductivity: e.target.value === '' ? 0 : Number(e.target.value)})}
                      onFocus={(e) => e.target.select()}
                      className="w-full bg-transparent border-b border-[#141414] py-1 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono opacity-50">
                      <FlaskConical size={12} /> Уровень pH
                    </label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={waterParams.ph || ''}
                      onChange={(e) => setWaterParams({...waterParams, ph: e.target.value === '' ? 0 : Number(e.target.value)})}
                      onFocus={(e) => e.target.select()}
                      className="w-full bg-transparent border-b border-[#141414] py-1 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono opacity-50">
                      <Beaker size={12} /> Жесткость (ppm)
                    </label>
                    <input 
                      type="number" 
                      value={waterParams.hardness || ''}
                      onChange={(e) => setWaterParams({...waterParams, hardness: e.target.value === '' ? 0 : Number(e.target.value)})}
                      onFocus={(e) => e.target.select()}
                      className="w-full bg-transparent border-b border-[#141414] py-1 focus:outline-none"
                    />
                  </div>
                </div>

                <button 
                  onClick={handleWaterTreatment}
                  disabled={loading}
                  className="w-full bg-[#141414] text-[#E4E3E0] py-3 text-xs uppercase tracking-[0.2em] font-mono flex items-center justify-center gap-2 hover:bg-opacity-90 transition-all disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin" size={16} /> : 'Сформировать рецепты'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="bg-[#141414] text-[#E4E3E0] p-4 text-[10px] font-mono uppercase tracking-widest leading-relaxed opacity-90">
            <div className="flex items-center gap-2 mb-2">
              <Info size={14} />
              <span>Статус системы</span>
            </div>
            <div className="flex justify-between border-t border-white/20 pt-2">
              <span>Поиск в сети:</span>
              <span className="text-emerald-400">Активен</span>
            </div>
            <div className="flex justify-between">
              <span>Движок:</span>
              <span>Gemini 3 Flash</span>
            </div>
          </div>
        </div>

        {/* Results Section */}
        <div className="lg:col-span-7">
          <div className="bg-white border border-[#141414] min-h-[500px] flex flex-col shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="border-b border-[#141414] p-4 flex justify-between items-center bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      if (activeTab === 'bentonite' && resultTab !== 'analysis') {
                        handleBentoniteSearch();
                      } else if (activeTab === 'water' && resultTab !== 'water') {
                        handleWaterTreatment();
                      }
                    }}
                    disabled={loading || (activeTab === 'bentonite' && !brandName && !uploadedImageUrl)}
                    className={`text-[10px] uppercase tracking-widest font-mono px-3 py-1 border border-[#141414] transition-colors disabled:opacity-50 ${
                      (resultTab === 'analysis' || resultTab === 'water') ? 'bg-[#141414] text-white' : 'hover:bg-[#141414] hover:text-white'
                    }`}
                  >
                    {activeTab === 'bentonite' ? 'Отчет об анализе' : 'Рецепты воды'}
                  </button>
                  {activeTab === 'bentonite' && (brandName || uploadedImageUrl) && (
                    <>
                      <button 
                        onClick={handleCompositionSearch}
                        disabled={loading}
                        className={`text-[10px] uppercase tracking-widest font-mono px-3 py-1 border border-[#141414] transition-colors disabled:opacity-50 ${
                          resultTab === 'composition' ? 'bg-[#141414] text-white' : 'hover:bg-[#141414] hover:text-white'
                        }`}
                      >
                        Состав бентопорошка
                      </button>
                      <button 
                        onClick={handleAnalogsSearch}
                        disabled={loading}
                        className={`text-[10px] uppercase tracking-widest font-mono px-3 py-1 border border-[#141414] transition-colors disabled:opacity-50 ${
                          resultTab === 'analogs' ? 'bg-[#141414] text-white' : 'hover:bg-[#141414] hover:text-white'
                        }`}
                      >
                        Аналоги
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-[#141414]"></div>
                <div className="w-2 h-2 rounded-full bg-[#141414] opacity-40"></div>
                <div className="w-2 h-2 rounded-full bg-[#141414] opacity-20"></div>
              </div>
            </div>

            <div className="flex-1 p-8 overflow-y-auto">
              {loading && !result ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-60">
                  <div className="relative">
                    <Loader2 className="animate-spin text-[#141414]" size={48} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 bg-[#141414] rounded-full animate-pulse"></div>
                    </div>
                  </div>
                  <div className="text-center space-y-1">
                    <p className="font-mono text-xs uppercase tracking-widest font-bold">Обработка данных</p>
                    <p className="font-mono text-[10px] uppercase tracking-wider opacity-60 animate-pulse">{loadingStep || 'Пожалуйста, подождите...'}</p>
                    <button 
                      onClick={() => abortControllerRef.current?.abort()}
                      className="mt-4 px-4 py-1 border border-[#141414] text-[8px] uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-white transition-colors"
                    >
                      Отменить
                    </button>
                  </div>
                </div>
              ) : error ? (
                <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
                  <AlertCircle size={48} className="text-red-500" />
                  <div className="space-y-2">
                    <p className="font-mono text-xs uppercase tracking-widest text-red-600 font-bold">Произошла ошибка</p>
                    <p className="text-sm text-gray-600 max-w-md">{error}</p>
                  </div>
                  <button 
                    onClick={() => { setError(null); setResult(null); }}
                    className="px-6 py-2 border border-[#141414] text-[10px] uppercase tracking-widest font-mono hover:bg-[#141414] hover:text-white transition-colors"
                  >
                    Попробовать снова
                  </button>
                </div>
              ) : result ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="prose prose-sm max-w-none prose-headings:font-serif prose-headings:italic prose-headings:border-b prose-headings:border-[#141414] prose-headings:pb-2 prose-p:font-sans prose-strong:font-mono prose-strong:uppercase prose-strong:text-[10px] prose-strong:tracking-widest"
                >
                  <div className="markdown-body overflow-x-auto">
                    <Markdown>{result}</Markdown>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-6 opacity-20 grayscale">
                  <Droplets size={80} strokeWidth={1} />
                  <div className="text-center space-y-2">
                    <p className="font-serif italic text-2xl">Ожидание ввода</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em]">Выберите марку или введите параметры воды</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-[#141414] p-6 text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] font-mono opacity-40">
          © 2026 ГНБ Тех Решения • Промышленный анализ буровых растворов
        </p>
      </footer>
    </div>
  );
}
