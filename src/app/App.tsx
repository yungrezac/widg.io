import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";

// ── Supabase Configuration (REST API) ───────────────────────────────────────
const SUPABASE_URL = 'https://lqjagftaeejdufwwvjwd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6-9IBhMX9CMVbIackZAJ9g_UUk5FDqx';

async function supabaseFetch(endpoint: string, options: RequestInit = {}) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, { ...options, headers });
  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.statusText}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Widget {
  id: number;
  name: string;
  category: string;
  icon_name: string;
  gradient: string;
  installs: number;
  rating: number;
  reviews: number;
  author: string;
  description: string;
  tags: string[];
  code_content?: string; // Теперь храним код вместо внешнего URL
  is_new?: boolean;
  is_featured?: boolean;
  is_premium?: boolean;
}

const CATEGORIES = [
  "Все", "Алерты", "Чат", "Донаты", "Цели",
  "Таймер", "Игры", "Музыка", "Статистика", "Эффекты", "Опросы", "Погода",
];

const GRADIENTS = [
  "linear-gradient(135deg,#f97316,#ef4444)", "linear-gradient(135deg,#3b82f6,#06b6d4)",
  "linear-gradient(135deg,#ec4899,#8b5cf6)", "linear-gradient(135deg,#10b981,#059669)",
  "linear-gradient(135deg,#8b5cf6,#6d28d9)", "linear-gradient(135deg,#eab308,#f97316)",
];

const CHECKER = {
  backgroundImage: "linear-gradient(45deg,#1e2c3a 25%,transparent 25%), linear-gradient(-45deg,#1e2c3a 25%,transparent 25%), linear-gradient(45deg,transparent 75%,#1e2c3a 75%), linear-gradient(-45deg,transparent 75%,#1e2c3a 75%)",
  backgroundSize: "14px 14px",
  backgroundPosition: "0 0,0 7px,7px -7px,-7px 0px",
  backgroundColor: "#141f2a",
};

const fmtInstalls = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ── Icons Helper ─────────────────────────────────────────────────────────
function CategoryIcon({ cat }: { cat: string }) {
  const map: Record<string, keyof typeof Icons> = {
    "Алерты": "Zap", "Чат": "MessageCircle", "Донаты": "Gift", "Цели": "Target",
    "Таймер": "Clock", "Игры": "Gamepad2", "Музыка": "Music2", "Статистика": "BarChart2",
    "Эффекты": "Sparkles", "Опросы": "BarChart", "Погода": "Cloud",
  };
  const iconName = map[cat] ?? "LayoutGrid";
  const Icon = (Icons as any)[iconName] || Icons.LayoutGrid;
  return <Icon size={14} />;
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [activeNav, setActiveNav] = useState<"home" | "installed" | "profile" | "upload">("home");
  const [activeCategory, setActiveCategory] = useState("Все");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWidget, setSelectedWidget] = useState<Widget | null>(null);
  
  // App States
  const [userId, setUserId] = useState<string | null>(null);
  const [tiktokUsername, setTiktokUsername] = useState<string>("");
  
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: "", category: "Алерты", desc: "", code: "" });

  const catScrollRef = useRef<HTMLDivElement>(null);

  // 1. Setup Auth & Fetch Data (REST API)
  useEffect(() => {
    const initApp = async () => {
      let uid = localStorage.getItem('local_uid');
      
      if (!uid) {
        uid = crypto.randomUUID();
        localStorage.setItem('local_uid', uid);
      }
      setUserId(uid);

      const storedUsername = localStorage.getItem('tiktok_username');
      if (storedUsername) setTiktokUsername(storedUsername);

      await fetchWidgetsAndInstalls(uid);
    };

    initApp();
  }, []);

  const fetchWidgetsAndInstalls = async (uid: string) => {
    setLoading(true);
    try {
      // Не загружаем сам code_content в список, чтобы не грузить память, код берем только на сервере для OBS
      const widgetsData = await supabaseFetch('stream_widgets?select=id,name,category,icon_name,gradient,author,description,installs,rating,reviews,tags,is_new&order=created_at.desc');
      if (widgetsData) setWidgets(widgetsData as Widget[]);

      const installsData = await supabaseFetch(`stream_user_installs?select=widget_id&user_id=eq.${uid}`);
      if (installsData) {
        setInstalledIds(new Set(installsData.map((i: any) => i.widget_id)));
      }
    } catch (error) {
      console.error("Ошибка загрузки данных:", error);
    }
    setLoading(false);
  };

  const filteredWidgets = useMemo(() => {
    let list = activeNav === "installed" ? widgets.filter(w => installedIds.has(w.id)) : widgets;
    if (activeNav === "home" || activeNav === "upload") {
      if (activeCategory !== "Все") list = list.filter(w => w.category === activeCategory);
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        list = list.filter(w =>
          w.name.toLowerCase().includes(q) || w.category.toLowerCase().includes(q)
        );
      }
    }
    return list;
  }, [activeNav, activeCategory, searchQuery, installedIds, widgets]);

  // Handle syncing installs
  const handleInstall = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!userId) return;

    const next = new Set(installedIds);
    const isAdding = !next.has(id);

    try {
      if (isAdding) {
        next.add(id);
        await supabaseFetch('stream_user_installs', {
          method: 'POST',
          body: JSON.stringify({ user_id: userId, widget_id: id })
        });
      } else {
        next.delete(id);
        await supabaseFetch(`stream_user_installs?user_id=eq.${userId}&widget_id=eq.${id}`, {
          method: 'DELETE'
        });
      }
      setInstalledIds(next);
    } catch (error) {
      console.error("Ошибка обновления:", error);
    }
  };

  // Upload custom widget (Now saves CODE instead of URL)
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setIsUploading(true);

    const newWidget = {
      name: uploadForm.name,
      category: uploadForm.category,
      description: uploadForm.desc,
      author: tiktokUsername || "Анонимный Стример",
      icon_name: "Code",
      gradient: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)],
      code_content: uploadForm.code, // СОХРАНЯЕМ КОД
      tags: [],
      is_new: true
    };

    try {
      const data = await supabaseFetch('stream_widgets', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(newWidget)
      });
      
      if (data && data.length > 0) {
        setWidgets([data[0] as Widget, ...widgets]);
        setActiveNav("home");
        setUploadForm({ name: "", category: "Алерты", desc: "", code: "" });
      }
    } catch (error: any) {
      alert("Ошибка при загрузке: " + error.message);
    }
    setIsUploading(false);
  };

  // Генерируем ссылку, которая ведет на наш собственный сервер
  const handleCopy = (widget: Widget, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!tiktokUsername) {
      alert("Пожалуйста, укажите ваш TikTok Username в профиле для создания ссылки!");
      return setActiveNav("profile");
    }

    // Динамическая ссылка на наш сервер (Railway)
    const host = window.location.origin;
    const finalUrl = `${host}/w/${widget.id}?user=${tiktokUsername}`;

    const el = document.createElement('textarea');
    el.value = finalUrl;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);

    setCopiedId(widget.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const saveTiktokUsername = (val: string) => {
    setTiktokUsername(val);
    localStorage.setItem('tiktok_username', val);
  };

  if (loading) {
    return (
      <div className="min-h-screen w-full flex justify-center items-center bg-background">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
          <Icons.Loader2 size={48} className="text-primary" />
        </motion.div>
      </div>
    );
  }

  // --- Components for Sub-views ---
  const Sidebar = () => (
    <nav className="hidden md:flex flex-col w-64 border-r border-border bg-card/50 p-4 h-full">
      <div className="flex items-center gap-3 mb-10 px-2 mt-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#69c9d0] to-[#ee1d52] shadow-lg">
          <Icons.Play size={20} fill="#fff" color="#fff" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">StreamKit</h1>
          <p className="text-xs text-muted-foreground leading-tight">TikTok Live Tools</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {[
          { id: "home", Icon: Icons.Home, label: "Каталог виджетов" },
          { id: "installed", Icon: Icons.Bookmark, label: "Мои виджеты", badge: installedIds.size },
          { id: "upload", Icon: Icons.Code, label: "Создать виджет" },
          { id: "profile", Icon: Icons.User2, label: "Мой профиль и API" },
        ].map(({ id, Icon, label, badge }) => (
          <button
            key={id}
            onClick={() => setActiveNav(id as any)}
            className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
              activeNav === id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-secondary/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Icon size={18} />
              <span className="text-sm">{label}</span>
            </div>
            {badge !== undefined && badge > 0 && (
               <span className="bg-primary/20 text-primary text-[10px] px-2 py-0.5 rounded-full font-bold">
                 {badge}
               </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );

  const BottomBar = () => (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border flex items-center justify-around px-2 pt-2 pb-5 bg-background/90 backdrop-blur-xl z-30">
      {[
        { id: "home", Icon: Icons.Home, label: "Каталог" },
        { id: "installed", Icon: Icons.Bookmark, label: "Мои" },
        { id: "upload", Icon: Icons.Code, label: "Создать" },
        { id: "profile", Icon: Icons.User2, label: "Профиль" },
      ].map(({ id, Icon, label }) => {
        const active = activeNav === id;
        return (
          <button
            key={id}
            onClick={() => setActiveNav(id as any)}
            className={`flex flex-col items-center gap-1 px-4 py-1 rounded-xl transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
          >
            <div className={`p-1.5 rounded-xl transition-all ${active ? "bg-primary/15" : ""}`}>
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
            </div>
            <span className={`text-[10px] font-medium ${active ? "text-primary" : ""}`}>{label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto relative pb-24 md:pb-8 flex flex-col">
        
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-5 py-4 border-b border-border/50 sticky top-0 bg-background/90 backdrop-blur z-20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#69c9d0] to-[#ee1d52]">
              <Icons.Play size={14} fill="#fff" color="#fff" />
            </div>
            <h1 className="text-sm font-bold text-foreground">StreamKit</h1>
          </div>
        </header>

        <div className="max-w-6xl w-full mx-auto p-4 md:p-8 flex-1">
          {/* ── HOME & INSTALLED VIEWS ── */}
          {(activeNav === "home" || activeNav === "installed") && (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-foreground tracking-tight">
                    {activeNav === "home" ? "Каталог виджетов" : "Моя библиотека"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {activeNav === "home" ? "Универсальные оверлеи для TikTok Live, работающие на нашем API" : "Виджеты, добавленные в ваш аккаунт"}
                  </p>
                </div>
                
                {activeNav === "home" && (
                  <div className="relative w-full md:w-72">
                    <Icons.Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Поиск..."
                      className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>
                )}
              </div>

              {activeNav === "home" && (
                <div ref={catScrollRef} className="flex gap-2 pb-6 overflow-x-auto scrollbar-hide">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                        activeCategory === cat ? "bg-primary text-primary-foreground shadow-md" : "bg-card border border-border text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {cat !== "Все" && <CategoryIcon cat={cat} />}
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {filteredWidgets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-3xl border border-border">
                  <Icons.LayoutGrid size={48} className="text-muted-foreground opacity-30 mb-4" />
                  <p className="text-base font-semibold text-foreground">Ничего не найдено</p>
                  <p className="text-sm text-muted-foreground mt-1">Попробуйте изменить категорию или поисковый запрос</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-5">
                  {filteredWidgets.map(widget => {
                    const isInstalled = installedIds.has(widget.id);
                    const Icon = (Icons as any)[widget.icon_name] || Icons.LayoutGrid;
                    
                    return (
                      <motion.div
                        key={widget.id}
                        whileHover={{ y: -4 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedWidget(widget)}
                        className="bg-card rounded-2xl overflow-hidden border border-border cursor-pointer group flex flex-col"
                      >
                        <div className="relative h-28 md:h-36 w-full flex-shrink-0" style={CHECKER}>
                          <div className="absolute inset-0 opacity-20" style={{ background: widget.gradient }} />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform" style={{ background: widget.gradient }}>
                              <Icon size={24} color="#fff" strokeWidth={1.8} />
                            </div>
                          </div>
                          {widget.is_new && (
                            <span className="absolute top-2 left-2 bg-emerald-500/20 text-emerald-400 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md border border-emerald-500/30">New</span>
                          )}
                        </div>
                        
                        <div className="p-3 md:p-4 flex flex-col flex-1">
                          <h3 className="text-xs md:text-sm font-semibold text-foreground leading-tight line-clamp-2 mb-1 md:mb-2">{widget.name}</h3>
                          <div className="flex items-center gap-1 mb-auto">
                            <span className="text-[10px] md:text-xs text-muted-foreground">{widget.author}</span>
                          </div>
                          
                          <div className="flex items-center justify-between mt-3">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Icons.Download size={12} />
                              <span className="text-[10px] md:text-xs">{fmtInstalls(widget.installs)}</span>
                            </div>
                            <button
                              onClick={e => handleInstall(widget.id, e)}
                              className={`text-[10px] md:text-xs font-semibold px-2.5 md:px-3 py-1.5 rounded-lg transition-all ${
                                isInstalled ? "bg-emerald-500/20 text-emerald-400" : "bg-primary/20 text-primary hover:bg-primary hover:text-white"
                              }`}
                            >
                              {isInstalled ? "Добавлен" : "Добавить"}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── UPLOAD VIEW (Code Input) ── */}
          {activeNav === "upload" && (
            <div className="max-w-3xl mx-auto py-4">
               <div className="mb-8 text-center">
                 <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Icons.Code2 size={28} className="text-primary" />
                 </div>
                 <h2 className="text-2xl font-bold text-foreground">Создать и захостить виджет</h2>
                 <p className="text-sm text-muted-foreground mt-2">
                   Вставьте ваш HTML/JS код ниже. Наш сервис сохранит его и будет выступать хостингом для виджета.
                 </p>
               </div>

               <form onSubmit={handleUpload} className="bg-card border border-border rounded-3xl p-6 md:p-8 space-y-5">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                   <div>
                     <label className="block text-sm font-medium text-foreground mb-1.5">Название виджета</label>
                     <input required value={uploadForm.name} onChange={e => setUploadForm({...uploadForm, name: e.target.value})} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:border-primary outline-none" placeholder="Дождь из роз..." />
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-foreground mb-1.5">Категория</label>
                     <select value={uploadForm.category} onChange={e => setUploadForm({...uploadForm, category: e.target.value})} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:border-primary outline-none">
                       {CATEGORIES.filter(c => c !== "Все").map(c => <option key={c} value={c}>{c}</option>)}
                     </select>
                   </div>
                 </div>
                 <div>
                   <label className="block text-sm font-medium text-foreground mb-1.5">Описание</label>
                   <textarea required value={uploadForm.desc} onChange={e => setUploadForm({...uploadForm, desc: e.target.value})} className="w-full h-20 bg-background border border-border rounded-xl px-4 py-3 text-sm focus:border-primary outline-none resize-none" placeholder="Опишите, что делает ваш виджет..."></textarea>
                 </div>
                 <div>
                   <label className="block text-sm font-medium text-foreground mb-1.5 flex justify-between">
                     <span>Исходный код (HTML + JS + CSS)</span>
                     <span className="text-xs text-muted-foreground font-normal">Будет доступен по ссылке /w/ID</span>
                   </label>
                   <textarea 
                     required 
                     value={uploadForm.code} 
                     onChange={e => setUploadForm({...uploadForm, code: e.target.value})} 
                     className="w-full h-64 bg-background border border-border rounded-xl px-4 py-3 text-xs font-mono focus:border-primary outline-none resize-y text-green-400" 
                     placeholder={`<!DOCTYPE html>\n<html>\n<head>\n  <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>\n</head>\n<body>\n  <!-- Ваш код виджета -->\n</body>\n</html>`}
                   ></textarea>
                 </div>
                 <button disabled={isUploading} type="submit" className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                   {isUploading ? "Сохранение и публикация..." : "Захостить виджет"}
                 </button>
               </form>
            </div>
          )}

          {/* ── PROFILE & API DOCS VIEW ── */}
          {activeNav === "profile" && (
            <div className="max-w-3xl mx-auto py-4 space-y-8">
              <div className="bg-card rounded-3xl border border-border p-6 md:p-8 flex flex-col md:flex-row gap-6 md:items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-white uppercase bg-gradient-to-r from-blue-500 to-purple-500 shadow-xl">
                    {tiktokUsername ? tiktokUsername.charAt(0) : "S"}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">
                      {tiktokUsername ? `@${tiktokUsername}` : "Настройте аккаунт"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">ID: {userId?.slice(0,8)}...</p>
                  </div>
                </div>
                
                <div className="bg-background rounded-2xl p-4 border border-border flex-1 md:max-w-xs">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ваш TikTok Username</label>
                  <input
                    value={tiktokUsername}
                    onChange={e => saveTiktokUsername(e.target.value)}
                    placeholder="Например: jake_streamer"
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm font-medium focus:border-primary outline-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-2 leading-tight">
                    Необходим для генерации персональных ссылок для OBS.
                  </p>
                </div>
              </div>

              {/* API Documentation */}
              <div className="bg-card rounded-3xl border border-border p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
                    <Icons.Code2 size={20} />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">API для разработчиков виджетов</h3>
                </div>

                <div className="prose prose-invert prose-sm max-w-none space-y-4 text-muted-foreground">
                  <p>
                    Все виджеты размещаются на нашем сервере. При вставке в OBS к ссылке будет добавлен параметр <code>?user=ИМЯ_СТРИМЕРА</code>. Ваш код должен прочитать этот параметр и подключиться к нашему вебсокету.
                  </p>
                  
                  <h4 className="text-foreground font-semibold text-base mt-6">Пример базового виджета</h4>
                  <pre className="bg-background p-4 rounded-xl border border-border overflow-x-auto">
                    <code className="text-xs text-blue-400">
{`<!DOCTYPE html>
<html>
<head>
  <!-- Подключаем Socket.io -->
  <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
</head>
<body>
  <div id="container"></div>

  <script>
    // 1. Получаем username из URL параметров
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('user');

    // 2. Подключаемся к нашему серверу (он же раздает этот файл)
    const socket = io(window.location.origin);

    socket.on("connect", () => {
        // Подписываемся на события стримера
        socket.emit("join_stream", username);
    });

    // 3. Слушаем события
    socket.on("chat_message", (data) => {
        const div = document.createElement("div");
        div.innerText = data.nickname + ": " + data.comment;
        document.getElementById("container").appendChild(div);
    });
  </script>
</body>
</html>`}
                    </code>
                  </pre>

                  <h4 className="text-foreground font-semibold text-base mt-6">События (Events)</h4>
                  <div className="space-y-3">
                    <div className="bg-background p-3 rounded-xl border border-border">
                      <p className="text-emerald-400 font-mono text-xs mb-1">stream_status</p>
                      <p className="text-xs">Вызывается при подключении и смене статуса. <code>{`{ isLive: boolean, error?: string }`}</code></p>
                    </div>
                    <div className="bg-background p-3 rounded-xl border border-border">
                      <p className="text-emerald-400 font-mono text-xs mb-1">chat_message</p>
                      <p className="text-xs">Новое сообщение. <code>{`{ nickname, comment, profilePictureUrl }`}</code></p>
                    </div>
                    <div className="bg-background p-3 rounded-xl border border-border">
                      <p className="text-emerald-400 font-mono text-xs mb-1">gift_received</p>
                      <p className="text-xs">Подарки (после комбо). <code>{`{ giftName, diamondCount, repeatCount }`}</code></p>
                    </div>
                    <div className="bg-background p-3 rounded-xl border border-border">
                      <p className="text-emerald-400 font-mono text-xs mb-1">like_received</p>
                      <p className="text-xs">Лайки от зрителей. <code>{`{ likeCount, totalLikes }`}</code></p>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>
      </main>

      <BottomBar />

      {/* ── WIDGET DETAILS MODAL ── */}
      <AnimatePresence>
        {selectedWidget && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedWidget(null)}
              className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed z-50 left-0 right-0 bottom-0 md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full md:w-[500px] bg-card md:rounded-3xl rounded-t-3xl border border-border overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="md:hidden flex justify-center pt-3 pb-2 bg-card">
                <div className="w-12 h-1.5 bg-border rounded-full" />
              </div>

              <div className="overflow-y-auto p-5 md:p-6 scrollbar-hide">
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: selectedWidget.gradient }}>
                       {React.createElement((Icons as any)[selectedWidget.icon_name] || Icons.Code, { size: 30, color: "#fff" })}
                    </div>
                    <div>
                      <h2 className="font-bold text-lg text-foreground leading-tight">{selectedWidget.name}</h2>
                      <p className="text-sm text-muted-foreground mt-1">от {selectedWidget.author}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedWidget(null)} className="p-2 rounded-full bg-secondary text-muted-foreground hover:bg-secondary/80">
                    <Icons.X size={18} />
                  </button>
                </div>

                <div className="relative h-48 w-full rounded-2xl overflow-hidden mb-5" style={CHECKER}>
                   <div className="absolute inset-0 opacity-20" style={{ background: selectedWidget.gradient }} />
                   <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl transform scale-110" style={{ background: selectedWidget.gradient }}>
                        {React.createElement((Icons as any)[selectedWidget.icon_name] || Icons.Code, { size: 32, color: "#fff" })}
                      </div>
                      <span className="text-xs text-white/70 font-mono uppercase tracking-widest px-3 py-1 bg-black/40 rounded-full backdrop-blur-md">Прозрачный фон для OBS</span>
                   </div>
                </div>

                <p className="text-sm text-foreground/80 leading-relaxed mb-6">
                  {selectedWidget.description || "Оверлей для отображения активности на вашем стриме TikTok. Подходит для OBS и Streamlabs."}
                </p>

                <div className="bg-background rounded-2xl p-4 border border-border mb-6">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Ссылка для Browser Source</h3>
                  <div className="flex gap-2">
                    <code className="text-xs text-muted-foreground flex-1 truncate bg-card border border-border px-3 py-2.5 rounded-xl font-mono flex items-center">
                      {tiktokUsername 
                        ? `${window.location.origin}/w/${selectedWidget.id}?user=${tiktokUsername}` 
                        : "Сначала укажите Username в профиле"}
                    </code>
                    <button
                      onClick={(e) => handleCopy(selectedWidget, e)}
                      className="shrink-0 w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity"
                    >
                      {copiedId === selectedWidget.id ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={(e) => handleInstall(selectedWidget.id, e)}
                  className={`w-full py-4 rounded-xl font-bold text-sm transition-all shadow-lg ${
                    installedIds.has(selectedWidget.id)
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                      : "text-white"
                  }`}
                  style={installedIds.has(selectedWidget.id) ? {} : { background: selectedWidget.gradient }}
                >
                  {installedIds.has(selectedWidget.id) ? "✓ Добавлен в библиотеку" : "Добавить в мои виджеты"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
