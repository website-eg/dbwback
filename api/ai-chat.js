// api/ai-chat.js
// Groq AI — "روبو" Multi-role assistant with Function Calling
// Model: Llama 3.3 70B | Architecture: Tool Use (Function Calling)
//
// 🧠 HOW IT WORKS:
// 1. User sends message → Groq receives it with available tools
// 2. Groq DECIDES which tools to call (if any) based on the question
// 3. We execute the tool calls → return results to Groq
// 4. Groq formulates a natural response using the real data
//
// No more keyword matching. The AI decides what it needs.

import admin from "firebase-admin";

if (!admin.apps.length) {
    if (!process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error("Missing FIREBASE_PRIVATE_KEY");
    }
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
    });
}

const db = admin.firestore();

// ─── API Key Rotation (supports up to 20 keys) ───
const GROQ_API_KEYS = [];
for (let i = 1; i <= 20; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key) GROQ_API_KEYS.push(key);
}
// Fallback to single key if no numbered keys found
if (GROQ_API_KEYS.length === 0 && process.env.GROQ_API_KEY) {
    GROQ_API_KEYS.push(process.env.GROQ_API_KEY);
}
let _keyIndex = 0;
function getNextKey() {
    if (GROQ_API_KEYS.length === 0) return null;
    const key = GROQ_API_KEYS[_keyIndex % GROQ_API_KEYS.length];
    _keyIndex++;
    return key;
}
console.log(`🔑 Loaded ${GROQ_API_KEYS.length} Groq API keys`);

// ═══════════════════════════════════════════════
// SYSTEM PROMPTS — Clean, no data logic needed
// ═══════════════════════════════════════════════

const BASE_RULES = `أنت "روبو" 🤖 — مساعد ذكي بشخصية ودودة ومحفزة لتطبيق "بِرّ الوالدين" لتحفيظ القرآن الكريم.
- تتحدث بالعربية الفصحى البسيطة مع إيموجي مناسب.
- ردودك مختصرة وذكية. لا إطالة بلا فائدة.
- أنت خبير بالقرآن والتجويد والتربية الإسلامية والتعليم.

❗ قواعد الرد:
1. تصرف وكأنك تعرف كل شيء بنفسك. لا تقل "بعد تحليل البيانات" أو "وفقاً للسجلات" أبداً.
2. عند عرض بيانات، استخدم أرقام محددة ورتّبها بوضوح.
3. إذا سأل عن "أمس" أو "البارحة" → استخدم date="yesterday". إذا سأل عن "اليوم" → date="today".
4. لا تقترح فتح المصحف أو تشغيل سور.
5. إذا لم تجد بيانات → "ما عندي هالمعلومة حالياً".

🔀 متى تستخدم الأدوات ومتى تُجيب مباشرة:
- أسئلة عن بيانات محددة (حضور، درجات، سلوك، طلاب، حلقات، اختبارات، سرد، أعذار...) ← استخدم الأدوات.
- أسئلة عامة (دينية، قرآنية، فقهية، تعليمية، تحفيزية، نصائح تربوية، معلومات عامة، أسئلة عن التطبيق) ← أجب مباشرة بدون أدوات.
- أنت لست مقتصراً على الأدوات! أجب بثقة عن أي موضوع إسلامي أو تعليمي أو تربوي.

🧠 الذكاء المحادثي (مهم جداً):
- افهم السياق من الرسائل السابقة. إذا سأل "ومين غاب؟" بعد سؤال عن الحضور → يقصد تفاصيل الغياب.
- إذا سأل "وسلوكه؟" بعد سؤال عن طالب → يقصد نفس الطالب.
- إذا قال "وأمس؟" بعد سؤال عن اليوم → يريد نفس البيانات لكن ليوم أمس.
- لا تكرر نفس الإجابة لأسئلة مختلفة. كل سؤال يحتاج بيانات جديدة بمعاملات مختلفة.
- استخدم أكثر من أداة معاً للإجابات الشاملة. مثلاً: "تقرير شامل" = overview + alerts + scores.

📊 تحليل البيانات:
- لا تكتفي بعرض الأرقام — حلّل، قارن، استنتج، وانصح.
- إذا رأيت مشكلة (غياب كثير، درجات منخفضة) ← نبّه تلقائياً.
- قدّم نصائح عملية مبنية على البيانات.

💬 شخصيتك:
- كن محفزاً ومشجعاً مع الطلاب.
- كن مهنياً ومختصراً مع المعلمين.
- كن تحليلياً واستراتيجياً مع المديرين.
- كن مطمئناً وداعماً مع أولياء الأمور.

أرجع دائماً JSON: {"reply": "نص الرد"}`;

const PROMPTS = {
    student: `${BASE_RULES}

أنت تتحدث مع **طالب**. نادِه باسمه الأول.

ماذا تفعل:
- "كم غبت؟" → get_attendance ثم أجب بالرقم
- "كم نجومي؟" → get_student_info
- "كيف أدائي؟" → get_attendance + get_scores + get_student_behavior معاً ثم لخّص
- "كيف أتحسن؟" → get_scores ثم نصائح مخصصة
- "كم سردت؟" / "تقدمي بالسرد" → get_student_sard_progress
- "نتائج اختباراتي" / "درجتي بالاختبار" → get_student_exams
- "سلوكي" / "نقاط السلوك" → get_student_behavior
- "حالة إذني" / "هل الإذن اتقبل" → get_student_excuses
- "ترتيبي" / "لوحة الشرف" / "مين الأول" → get_leaderboard
- "شهاداتي" / "التكريم" → get_student_certificates
- "تقرير شامل عني" → استخدم get_attendance + get_scores + get_student_behavior + get_student_sard_progress + get_student_exams كلهم معاً
- أسئلة دينية → أجب مباشرة

🧠 نصائح تلقائية: غياب≥3 نبّه. درجة<7 انصح. أداء ممتاز شجّع. سرد عالي قدّر.`,

    teacher: `${BASE_RULES}

أنت تتحدث مع **معلم**. نادِه "يا شيخ" أو باسمه.

ماذا تفعل:
- "مين متغيب؟" → get_halaqa_overview واذكر الأسماء
- "تقرير الحلقة" → get_halaqa_overview + get_halaqa_scores_and_behavior + get_smart_alerts كلهم معاً
- "تقرير عن أحمد" → search_student_by_name ثم get_attendance + get_scores
- "مين يحتاج متابعة؟" → get_smart_alerts
- "سلوك أحمد" / "سلوك الحلقة" → get_student_behavior_report
- "مقارنة أيام الأسبوع" / "وين أكثر غياب" → get_halaqa_attendance_comparison
- "إعلاناتي" / "التنويهات" → get_halaqa_announcements
- "تقرير شامل" → get_halaqa_overview + get_halaqa_scores_and_behavior + get_smart_alerts + get_student_behavior_report + get_halaqa_attendance_comparison

⚠️ كن استباقياً: غياب≥3 نبّه. درجات منخفضة أشر. حضور غير مسجل ذكّر. سلوك سلبي متكرر أشر.`,

    admin: `${BASE_RULES}

أنت تتحدث مع **مدير الأكاديمية**. ردودك مختصرة كمستشار محترف.

🎯 الأدوات حسب السؤال:
- "كم طالب؟" / "إحصائيات" → get_academy_overview
- "كم غياب اليوم؟" → get_academy_overview(date="today")
- "كم غياب أمس؟" → get_academy_overview(date="yesterday")
- "من هم؟" / "أكثر غياباً" → get_top_absent_students
- "تنبيهات" / "مشاكل" → get_academy_alerts
- "مقارنة الحلقات" → get_halaqat_comparison
- "طلبات الإذن" / "الأعذار" → get_leave_requests
- "إحصائيات السرد" → get_sard_overview
- "سلوك الطلاب" / "من لديه سلوكيات" → get_behavior_overview
- "سلوك طالب معين" → get_student_behavior_report(student_name=الاسم)
- "تقرير شامل" → get_academy_overview + get_academy_alerts + get_top_absent_students + get_leave_requests + get_sard_overview كلهم معاً

🔍 بحث عن طالب (مهم جداً):
- أي بحث عن طالب (بالاسم أو الكود أو الرقم القومي أو رقم الجوال أو تاريخ الميلاد) → استخدم get_student_management_info(student_name=القيمة)
- "طالب كوده 2019" أو "صاحب الكود 2019" أو حتى "2019" في سياق بحث → get_student_management_info(student_name="2019")
- "الرقم القومي 30604151205159" → get_student_management_info(student_name="30604151205159")
- "معلومات طالب أحمد" → get_student_management_info(student_name="أحمد")
- ⚡ أداة get_student_management_info تبحث في كل الحقول تلقائياً: اسم، كود، رقم قومي، هاتف، تاريخ ميلاد

⚠️ قواعد المدير:
- ابدأ بالتنبيهات العاجلة أولاً.
- قدّم توصيات عملية.
- قارن بين الحلقات إذا طُلب.
- إذا الغياب مرتفع نبّه حتى لو ما سأل.`,

    parent: `${BASE_RULES}

أنت تتحدث مع **ولي أمر** طالب. كن محترماً وودوداً.

ماذا تفعل:
- "كيف ابني؟" / "كيف أداؤه؟" → get_attendance + get_scores + get_student_behavior معاً ثم لخّص
- "هل ابني حاضر؟" / "حضور ابني" → get_attendance
- "درجات ابني" → get_scores
- "سلوك ابني" → get_student_behavior
- "اختبارات ابني" → get_student_exams
- "حالة الإذن" → get_student_excuses
- "كم سرد ابني" → get_student_sard_progress
- "شهادات ابني" → get_student_certificates
- "تقرير شامل" → استخدم كل الأدوات المتاحة

🧠 كن صريحاً مع ولي الأمر. اذكر الإيجابيات والسلبيات. قدّم نصائح لمتابعة الابن في البيت.
⚠️ إذا الأداء ضعيف، اقترح تواصل مع المعلم.`,
};

// ═══════════════════════════════════════════════
// TOOL DEFINITIONS — Groq Function Calling Schema
// ═══════════════════════════════════════════════

const PERIOD_PARAM = {
    type: "string",
    description: "الفترة الزمنية. القيم الممكنة: today (اليوم), week (الأسبوع), month (الشهر), semester (الفصل), year (العام الدراسي), all (كل البيانات). الافتراضي: month"
};

function getToolsForRole(role) {
    const commonTools = [
        {
            type: "function",
            function: {
                name: "get_student_info",
                description: "جلب كل معلومات الطالب: الاسم، الحلقة، النجوم، السلوك، الرقم القومي، تاريخ الميلاد، رقم ولي الأمر، السرد، المستوى",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب في النظام" }
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_attendance",
                description: "جلب سجل حضور وغياب طالب: عدد أيام الحضور، الغياب، الأعذار، حالة اليوم. يمكن تحديد الفترة.",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" },
                        period: PERIOD_PARAM
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_scores",
                description: "جلب درجات ومتوسطات طالب: درس، مراجعة، تلاوة، واجب + نصائح تحسين. يمكن تحديد الفترة.",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" },
                        period: PERIOD_PARAM
                    },
                    required: ["student_id"]
                }
            }
        },
    ];

    // ─── Student-specific tools ───
    const studentTools = [
        {
            type: "function",
            function: {
                name: "get_student_sard_progress",
                description: "جلب تقدم الطالب في السرد (التسميع): الأجزاء المكتملة، النسبة، الحجز القادم",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" }
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_student_exams",
                description: "جلب نتائج اختبارات الطالب: شفهي، تحريري، قاعدة نورانية مع المتوسطات",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" }
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_student_behavior",
                description: "جلب سجل سلوك الطالب: نقاط إيجابية وسلبية، آخر السجلات، ملخص",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" }
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_student_excuses",
                description: "جلب حالة طلبات الإذن (الاستئذان) للطالب: معلقة، مقبولة، مرفوضة",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" }
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_leaderboard",
                description: "جلب لوحة الشرف: ترتيب أفضل 10 طلاب بالنجوم + ترتيب الطالب الحالي",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب لمعرفة ترتيبه" }
                    },
                    required: ["student_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_student_certificates",
                description: "جلب شهادات التكريم التي حصل عليها الطالب",
                parameters: {
                    type: "object",
                    properties: {
                        student_id: { type: "string", description: "معرّف الطالب" }
                    },
                    required: ["student_id"]
                }
            }
        },
    ];

    const teacherTools = [
        {
            type: "function",
            function: {
                name: "get_halaqa_overview",
                description: "جلب نظرة شاملة عن الحلقة: قائمة الطلاب، حضور اليوم، إحصائيات الفترة المطلوبة، المتميزين وكثيري الغياب",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        period: PERIOD_PARAM
                    },
                    required: ["teacher_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_halaqa_scores_and_behavior",
                description: "جلب درجات طلاب الحلقة واختباراتهم وسجلات السلوك",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        period: PERIOD_PARAM
                    },
                    required: ["teacher_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "search_student_by_name",
                description: "بحث واسع عن طالب في حلقة المعلم بالاسم، الرقم القومي، رقم الهاتف، الكود، أو تاريخ الميلاد",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        student_name: { type: "string", description: "معيار البحث (اسم، كود، رقم، يوم ميلاد)" }
                    },
                    required: ["teacher_id", "student_name"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_smart_alerts",
                description: "جلب التنبيهات الذكية: طلاب كثيري الغياب، درجات منخفضة، حضور غير مسجل",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" }
                    },
                    required: ["teacher_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_student_behavior_report",
                description: "جلب تقرير السلوك الشامل لطلاب الحلقة أو لطالب معين",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        student_name: { type: "string", description: "اسم طالب معين (اختياري، إذا فارغ يجلب كل الحلقة)" }
                    },
                    required: ["teacher_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_halaqa_attendance_comparison",
                description: "مقارنة حضور الحلقة حسب أيام الأسبوع لمعرفة أنماط الغياب",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" },
                        period: PERIOD_PARAM
                    },
                    required: ["teacher_id"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_halaqa_announcements",
                description: "جلب آخر الإعلانات والتنويهات في الحلقة",
                parameters: {
                    type: "object",
                    properties: {
                        teacher_id: { type: "string", description: "معرّف المعلم" }
                    },
                    required: ["teacher_id"]
                }
            }
        },
    ];

    const adminTools = [
        {
            type: "function",
            function: {
                name: "get_academy_overview",
                description: "جلب إحصائيات الأكاديمية الشاملة: عدد الطلاب، الحلقات، نسبة الحضور، مقارنة الحلقات. يمكن تحديد تاريخ معين.",
                parameters: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "التاريخ بصيغة YYYY-MM-DD أو yesterday أو today. الافتراضي: today" }
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_academy_alerts",
                description: "جلب التنبيهات والمشاكل: حلقات لم تحضّر، طلاب كثيري الغياب، أداء منخفض، حالات نقل",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_academy_exams_and_behavior",
                description: "جلب ملخص اختبارات وسجلات السلوك لكل الأكاديمية",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_top_absent_students",
                description: "ترتيب أكثر الطلاب غياباً في الأكاديمية كلها",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM,
                        limit: { type: "string", description: "عدد النتائج المطلوبة (الافتراضي 10)" }
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_leave_requests",
                description: "جلب طلبات الإذن والأعذار: المعلقة والمقبولة والمرفوضة",
                parameters: {
                    type: "object",
                    properties: {
                        status: { type: "string", description: "حالة الطلب: pending (معلقة) أو approved (مقبولة) أو rejected (مرفوضة) أو all (الكل). الافتراضي: all" }
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_sard_overview",
                description: "جلب إحصائيات السرد في الأكاديمية: عدد الطلاب الذين سردوا، إجمالي الأجزاء، أفضل الطلاب",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_student_management_info",
                description: "بحث عن طالب في كل الأكاديمية بالاسم، الرقم القومي، رقم الهاتف، الكود، أو تاريخ الميلاد",
                parameters: {
                    type: "object",
                    properties: {
                        student_name: { type: "string", description: "معيار البحث (اسم، كود، رقم قومي/هاتف، يوم ميلاد)" }
                    },
                    required: ["student_name"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_halaqat_comparison",
                description: "مقارنة تفصيلية بين كل الحلقات: نسبة الحضور، متوسط الدرجات، عدد الطلاب",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_behavior_overview",
                description: "نظرة شاملة على سجلات السلوك في الأكاديمية: الطلاب الأكثر سلوكيات سلبية، أفضل الطلاب سلوكاً، إجمالي السجلات",
                parameters: {
                    type: "object",
                    properties: {
                        period: PERIOD_PARAM,
                        limit: { type: "string", description: "عدد النتائج (الافتراضي 10)" }
                    },
                    required: []
                }
            }
        },
    ];

    // Parent uses same tools as student (for their child)
    const parentTools = [...studentTools];

    switch (role) {
        case 'teacher': return [...commonTools, ...studentTools, ...teacherTools];
        case 'admin': return [...commonTools, ...studentTools, ...teacherTools, ...adminTools];
        case 'parent': return [...commonTools, ...parentTools];
        default: return [...commonTools, ...studentTools]; // student
    }
}

// ═══════════════════════════════════════════════
// TOOL IMPLEMENTATIONS — Each returns a string
// ═══════════════════════════════════════════════

function getTodayStr() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

function getDateStr(dateInput) {
    // If no input or 'today', return today
    if (!dateInput || dateInput === 'today') return getTodayStr();
    // If 'yesterday'
    if (dateInput === 'yesterday') {
        // Get "now" in Cairo timezone first, then subtract a day
        const nowInCairo = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
        nowInCairo.setDate(nowInCairo.getDate() - 1);
        return nowInCairo.toLocaleDateString("en-CA");
    }
    // If already YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
    // Try to parse
    const parsed = new Date(dateInput);
    if (!isNaN(parsed)) return parsed.toLocaleDateString("en-CA");
    return getTodayStr();
}

function getMonthRange() {
    return getDateRange('month');
}

// Flexible date range based on period
function getDateRange(period) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = getTodayStr();

    switch (period) {
        case 'today':
            return { start: today, end: today, label: 'اليوم' };

        case 'week': {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return {
                start: weekAgo.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
                end: today,
                label: 'الأسبوع'
            };
        }

        case 'month': {
            const m = String(month + 1).padStart(2, '0');
            const endDate = new Date(year, month + 1, 0);
            return {
                start: `${year}-${m}-01`,
                end: `${year}-${m}-${String(endDate.getDate()).padStart(2, '0')}`,
                label: `${m}/${year}`
            };
        }

        case 'semester': {
            // Academic semester: Sep-Jan or Feb-Jun
            const semStart = month >= 8 ? new Date(year, 8, 1) : new Date(year, 1, 1);
            const semEnd = month >= 8 ? new Date(year + 1, 0, 31) : new Date(year, 5, 30);
            return {
                start: semStart.toLocaleDateString('en-CA'),
                end: semEnd.toLocaleDateString('en-CA'),
                label: month >= 8 ? 'الفصل الأول' : 'الفصل الثاني'
            };
        }

        case 'year': {
            // Academic year: Sep to Jun
            const acStart = month >= 8 ? new Date(year, 8, 1) : new Date(year - 1, 8, 1);
            const acEnd = month >= 8 ? new Date(year + 1, 5, 30) : new Date(year, 5, 30);
            return {
                start: acStart.toLocaleDateString('en-CA'),
                end: acEnd.toLocaleDateString('en-CA'),
                label: month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`
            };
        }

        case 'all':
            return { start: '2020-01-01', end: '2099-12-31', label: 'كل الفترات' };

        default:
            return getDateRange('month');
    }
}

// ─── In-Memory Cache ───
const _cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute — fresh data for sequential questions

function getCached(key) {
    const entry = _cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    _cache.delete(key);
    return null;
}

function setCache(key, data) {
    _cache.set(key, { data, ts: Date.now() });
    if (_cache.size > 100) {
        // O(1) eviction: delete first (oldest inserted) key
        const firstKey = _cache.keys().next().value;
        if (firstKey) _cache.delete(firstKey);
    }
}

// ─── Tool: get_student_info ───
async function tool_get_student_info({ student_id }) {
    const ck = `info_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const doc = await db.collection('students').doc(student_id).get();
        if (!doc.exists) return JSON.stringify({ error: "الطالب غير موجود" });

        const s = doc.data();
        const result = JSON.stringify({
            student_id: doc.id,
            name: s.fullName || s.name || 'غير معروف',
            halaqa: s.halaqaName || 'غير محدد',
            type: s.type === 'reserve' ? 'احتياط' : 'أساسي',
            stars: s.stars || 0,
            behavior_points: s.behaviorPoints || 0,
            level: s.currentLevel || null,
            national_id: s.nationalId || null,
            birth_date: s.birthDate || null,
            gender: s.gender === 'male' ? 'ذكر' : s.gender === 'female' ? 'أنثى' : s.gender || null,
            parent_phone: s.parentPhone || null,
            sard_parts: Array.isArray(s.sard) ? s.sard.length : 0,
            joined: s.createdAt?.toDate?.()?.toLocaleDateString('en-CA') || null,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب بيانات الطالب" });
    }
}

// ─── Tool: get_attendance ───
async function tool_get_attendance({ student_id, period = 'month' }) {
    const ck = `att_${student_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const today = getTodayStr();
    const { start, end, label } = getDateRange(period);

    try {
        const snap = await db.collection('attendance')
            .where('studentId', '==', student_id)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();

        let present = 0, absent = 0, excused = 0;
        let todayStatus = 'لم يُسجّل بعد';

        snap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') present++;
            else if (d.status === 'absent') absent++;
            else if (d.status === 'excused') excused++;
            if (d.date === today) {
                todayStatus = d.status === 'present' || d.status === 'sard' ? 'حاضر' : d.status === 'absent' ? 'غائب' : 'إذن';
            }
        });

        const total = present + absent + excused;
        const rate = total > 0 ? Math.round((present / total) * 100) : 0;

        const result = JSON.stringify({
            period: label,
            present, absent, excused,
            total_days: total,
            attendance_rate: `${rate}%`,
            today: todayStatus,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الحضور" });
    }
}

// ─── Tool: get_scores ───
async function tool_get_scores({ student_id, period = 'month' }) {
    const ck = `scores_${student_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        const snap = await db.collection('progress')
            .where('studentId', '==', student_id)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();

        const docs = [];
        snap.forEach(doc => docs.push(doc.data()));
        docs.sort((a, b) => b.date.localeCompare(a.date));

        if (docs.length === 0) {
            return JSON.stringify({ message: `لا توجد درجات مسجلة في فترة ${label}` });
        }

        let sumL = 0, sumR = 0, sumT = 0, sumH = 0;
        docs.forEach(p => {
            sumL += Number(p.lessonScore || 0);
            sumR += Number(p.revisionScore || 0);
            sumT += Number(p.tilawaScore || 0);
            sumH += Number(p.homeworkScore || 0);
        });
        const n = docs.length;
        const avgL = Math.round(sumL / n * 10) / 10;
        const avgR = Math.round(sumR / n * 10) / 10;
        const avgT = Math.round(sumT / n * 10) / 10;
        const avgH = Math.round(sumH / n * 10) / 10;
        const avgTotal = Math.round((avgL + avgR + avgT + avgH) * 10) / 10;

        // Smart advice
        const advice = [];
        if (avgL < 7) advice.push("حضّر الدرس قبل الحصة");
        if (avgR < 7) advice.push("راجع حفظك 10 دقائق يومياً");
        if (avgH < 7) advice.push("لا تنسى الواجبات");
        if (avgT < 7) advice.push("أكثر من التلاوة");
        if (avgTotal >= 36) advice.push("أداء ممتاز! استمر 🌟");
        else if (avgTotal >= 30) advice.push("أداء جيد، شوية جهد إضافي وتوصل القمة 💪");

        const last3 = docs.slice(0, 3).map(p => ({
            date: p.date,
            lesson: p.lessonScore || 0,
            revision: p.revisionScore || 0,
            tilawa: p.tilawaScore || 0,
            homework: p.homeworkScore || 0,
            total: (Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0)),
            star: p.hasStar || false,
        }));

        const result = JSON.stringify({
            period: label,
            sessions: n,
            averages: { lesson: avgL, revision: avgR, tilawa: avgT, homework: avgH, total: avgTotal, max: 40 },
            last_sessions: last3,
            advice,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الدرجات" });
    }
}

// ─── Tool: get_halaqa_overview ───
async function tool_get_halaqa_overview({ teacher_id, period = 'month' }) {
    const ck = `halaqa_${teacher_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const today = getTodayStr();
    const { start, end, label } = getDateRange(period);

    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const teacher = teacherDoc.data();
        const halaqaId = teacher.halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "المعلم غير مربوط بحلقة" });

        const [studentsSnap, todayAttSnap, monthAttSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '==', today).get(),
            db.collection('attendance').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        const studentMap = {};
        studentsSnap.forEach(doc => { studentMap[doc.id] = doc.data().fullName || doc.data().name || 'بدون اسم'; });

        // Today
        const todayStatuses = {};
        todayAttSnap.forEach(doc => { todayStatuses[doc.data().studentId] = doc.data().status; });

        const absentToday = [], presentToday = [], notRecorded = [];
        studentsSnap.forEach(doc => {
            const name = studentMap[doc.id];
            const status = todayStatuses[doc.id];
            if (status === 'absent') absentToday.push(name);
            else if (status === 'present' || status === 'sard') presentToday.push(name);
            else notRecorded.push(name);
        });

        // Period stats
        const periodStats = {};
        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (!studentMap[d.studentId]) return;
            if (!periodStats[d.studentId]) periodStats[d.studentId] = { name: studentMap[d.studentId], present: 0, absent: 0 };
            if (d.status === 'present' || d.status === 'sard') periodStats[d.studentId].present++;
            else if (d.status === 'absent') periodStats[d.studentId].absent++;
        });

        const sorted = Object.values(periodStats).sort((a, b) => b.absent - a.absent);
        const mostAbsent = sorted.filter(s => s.absent >= 2).slice(0, 5).map(s => `${s.name} (${s.absent} أيام)`);
        const bestStudents = sorted.filter(s => s.present >= 5 && s.absent === 0).slice(0, 5).map(s => s.name);

        const result = JSON.stringify({
            teacher_name: teacher.name || teacher.displayName,
            halaqa: teacher.halaqaName || halaqaId,
            total_students: studentsSnap.size,
            today: {
                date: today,
                present: presentToday,
                absent: absentToday,
                not_recorded: notRecorded,
                attendance_recorded: notRecorded.length === 0,
            },
            period_stats: {
                label,
                most_absent: mostAbsent,
                best_students: bestStudents,
            }
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب بيانات الحلقة" });
    }
}

// ─── Tool: get_halaqa_scores_and_behavior ───
async function tool_get_halaqa_scores_and_behavior({ teacher_id, period = 'month' }) {
    const ck = `halaqa_sb_${teacher_id}_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const halaqaId = teacherDoc.data().halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "لا توجد حلقة" });

        // Build month keys that fall within the requested period
        const periodStart = new Date(start);
        const periodEnd = new Date(end);
        const monthKeys = [];
        const cursor = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
        while (cursor <= periodEnd) {
            monthKeys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const [studentsSnap, progressSnap] = await Promise.all([
            db.collection('students').where('halaqaId', '==', halaqaId).get(),
            db.collection('progress').where('halaqaId', '==', halaqaId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        const studentIds = new Set();
        const studentMap = {};
        studentsSnap.forEach(doc => { studentMap[doc.id] = doc.data().fullName || doc.data().name || '?'; studentIds.add(doc.id); });

        // Fetch exams for all relevant months (Firestore 'in' supports up to 30)
        const examsSnap = monthKeys.length > 0
            ? await db.collection('exams').where('monthKey', 'in', monthKeys.slice(0, 30)).get()
            : { forEach: () => { } };

        // Fetch behavior filtered by student IDs in this halaqa (up to 10 per query)
        const studentIdList = [...studentIds].slice(0, 10);
        const behaviorSnap = studentIdList.length > 0
            ? await db.collection('behavior_records').where('studentId', 'in', studentIdList).orderBy('createdAt', 'desc').limit(20).get()
            : { forEach: () => { } };

        // studentMap and studentIds already built above

        // Latest progress per student
        const latest = {};
        progressSnap.forEach(doc => {
            const d = doc.data();
            if (!latest[d.studentId] || d.date > latest[d.studentId].date) latest[d.studentId] = d;
        });

        const scores = Object.entries(latest).slice(0, 10).map(([sid, p]) => ({
            name: studentMap[sid] || '?',
            date: p.date,
            total: (Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0)),
            star: p.hasStar || false,
        }));

        // Exams for this halaqa
        const exams = [];
        examsSnap.forEach(doc => {
            const d = doc.data();
            if (studentIds.has(d.studentId)) {
                exams.push({
                    student: studentMap[d.studentId] || '?',
                    type: d.type === 'quran-oral' ? 'شفهي' : d.type === 'tajweed-written' ? 'تحريري' : 'قاعدة',
                    score: `${d.score}/50`,
                });
            }
        });

        // Behavior
        const behaviors = [];
        behaviorSnap.forEach(doc => {
            const d = doc.data();
            if (studentIds.has(d.studentId)) {
                behaviors.push({
                    student: d.studentName,
                    type: d.isPositive ? 'إيجابي 👍' : 'سلبي 👎',
                    category: d.category,
                    note: d.note || null,
                });
            }
        });

        const result = JSON.stringify({
            period: label,
            latest_scores: scores,
            exams: exams.slice(0, 8),
            recent_behavior: behaviors.slice(0, 5),
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الدرجات والسلوك" });
    }
}

// ─── Tool: search_student_by_name ───
// Universal search: by name, national ID, phone, or document ID
async function tool_search_student_by_name({ teacher_id, student_name }) {
    try {
        let studentsSnap;

        // If teacher_id provided and valid, search within their halaqa first
        if (teacher_id) {
            const teacherDoc = await db.collection('users').doc(teacher_id).get();
            if (teacherDoc.exists && teacherDoc.data().halaqaId) {
                studentsSnap = await db.collection('students').where('halaqaId', '==', teacherDoc.data().halaqaId).get();
            } else {
                studentsSnap = await db.collection('students').get();
            }
        } else {
            studentsSnap = await db.collection('students').get();
        }

        const searchLower = student_name.toLowerCase().trim();
        const searchWords = searchLower.split(/\s+/).filter(w => w.length > 1);
        const isNumeric = /^\d+$/.test(searchLower);
        const matches = [];

        studentsSnap.forEach(doc => {
            const d = doc.data();
            const name = (d.fullName || d.name || '').toLowerCase();
            const nationalId = (d.nationalId || '').toLowerCase();
            const phone = (d.parentPhone || '').toLowerCase();
            const code = (d.code || '').toLowerCase();
            const docId = doc.id.toLowerCase();
            const birthDate = (d.birthDate || '').toLowerCase();

            let matched = false;

            // Match by exact document ID
            if (docId === searchLower) matched = true;
            // Match by student code
            else if (code && (code === searchLower || code.includes(searchLower))) matched = true;
            // Match by national ID (numeric search)
            else if (isNumeric && nationalId && nationalId.includes(searchLower)) matched = true;
            // Match by phone (numeric search)
            else if (isNumeric && phone && phone.includes(searchLower)) matched = true;
            // Match by birthdate
            else if (birthDate && birthDate.includes(searchLower)) matched = true;
            // Match by full name (exact or contains full search)
            else if (name.includes(searchLower)) matched = true;
            // Match by ALL words (every word must appear in name)
            else if (searchWords.length >= 2 && searchWords.every(w => name.includes(w))) matched = true;

            if (matched) {
                matches.push({ data: d, id: doc.id });
            }
        });

        if (matches.length > 1) {
            return JSON.stringify({
                multiple: true,
                message: `وجدت ${matches.length} طلاب بهذا الاسم، حدد أيهم:`,
                students: matches.slice(0, 10).map(m => ({
                    id: m.id,
                    name: m.data.fullName || m.data.name,
                    halaqa: m.data.halaqaName || 'غير محدد',
                }))
            });
        }

        const found = matches.length === 1 ? matches[0].data : null;
        const foundId = matches.length === 1 ? matches[0].id : null;

        if (!found) return JSON.stringify({ error: `لم أجد طالب باسم "${student_name}"` });

        // Get attendance + scores for this student
        const { start, end } = getDateRange('year');
        const today = getTodayStr();

        const [attSnap, progSnap] = await Promise.all([
            db.collection('attendance').where('studentId', '==', foundId).where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('progress').where('studentId', '==', foundId).where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        let present = 0, absent = 0, todayStatus = 'لم يُسجّل';
        attSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'present' || d.status === 'sard') present++;
            else if (d.status === 'absent') absent++;
            if (d.date === today) todayStatus = d.status;
        });

        const progs = [];
        progSnap.forEach(doc => progs.push(doc.data()));
        progs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        let avgTotal = 0;
        if (progs.length > 0) {
            const sum = progs.reduce((acc, p) =>
                acc + Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0), 0);
            avgTotal = Math.round(sum / progs.length * 10) / 10;
        }

        return JSON.stringify({
            student_id: foundId,
            name: found.fullName || found.name,
            halaqa: found.halaqaName || 'غير محدد',
            type: found.type === 'reserve' ? 'احتياط' : 'أساسي',
            stars: found.stars || 0,
            attendance: { present, absent, today: todayStatus, total_days: present + absent },
            scores: {
                sessions: progs.length,
                avg_total: `${avgTotal}/40`,
                last: progs.slice(0, 3).map(p => ({
                    date: p.date,
                    total: Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0),
                }))
            }
        });
    } catch (e) {
        return JSON.stringify({ error: "فشل البحث عن الطالب" });
    }
}

// ─── Tool: get_smart_alerts (Teacher) ───
async function tool_get_smart_alerts({ teacher_id }) {
    const ck = `alerts_${teacher_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const overview = JSON.parse(await tool_get_halaqa_overview({ teacher_id }));
        if (overview.error) return JSON.stringify(overview);

        const alerts = [];

        // Attendance not recorded
        if (!overview.today.attendance_recorded) {
            alerts.push({ level: "⚠️", message: `لم يتم تسجيل حضور ${overview.today.not_recorded.length} طالب اليوم` });
        }

        // Absent today
        if (overview.today.absent.length > 0) {
            alerts.push({ level: "📋", message: `الغائبون اليوم: ${overview.today.absent.join('، ')}` });
        }

        // Frequent absences
        if (overview.period_stats.most_absent.length > 0) {
            overview.period_stats.most_absent.forEach(s => {
                alerts.push({ level: "🔴", message: `${s} — يحتاج متابعة` });
            });
        }

        if (alerts.length === 0) {
            alerts.push({ level: "✅", message: "كل شيء ممتاز اليوم!" });
        }

        const result = JSON.stringify({ alerts });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب التنبيهات" });
    }
}

// ─── Tool: get_academy_overview (Admin) ───
async function tool_get_academy_overview({ date } = {}) {
    const targetDate = getDateStr(date);
    const ck = `academy_overview_${targetDate}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const [studentsSnap, halaqatSnap, attSnap] = await Promise.all([
            db.collection('students').get(),
            db.collection('halaqat').get(),
            db.collection('attendance').where('date', '==', targetDate).get(),
        ]);

        let mainCount = 0, reserveCount = 0;
        studentsSnap.forEach(doc => {
            if (doc.data().type === 'reserve') reserveCount++;
            else mainCount++;
        });

        const halaqaNames = {};
        halaqatSnap.forEach(doc => { halaqaNames[doc.id] = doc.data().name || doc.id; });

        let todayPresent = 0, todayAbsent = 0, todayExcused = 0;
        const halaqaToday = {};
        const recordedHalaqas = new Set();

        attSnap.forEach(doc => {
            const d = doc.data();
            const hName = d.halaqaName || 'غير محدد';
            recordedHalaqas.add(d.halaqaId || hName);
            if (!halaqaToday[hName]) halaqaToday[hName] = { present: 0, absent: 0 };
            if (d.status === 'present' || d.status === 'sard') { todayPresent++; halaqaToday[hName].present++; }
            else if (d.status === 'absent') { todayAbsent++; halaqaToday[hName].absent++; }
            else if (d.status === 'excused') todayExcused++;
        });

        const total = todayPresent + todayAbsent + todayExcused;
        const rate = total > 0 ? Math.round((todayPresent / total) * 100) : 0;

        const unrecorded = Object.entries(halaqaNames).filter(([id]) => !recordedHalaqas.has(id)).map(([, n]) => n);

        const halaqaComparison = Object.entries(halaqaToday).map(([name, s]) => {
            const t = s.present + s.absent;
            return { name, present: s.present, total: t, rate: t > 0 ? `${Math.round((s.present / t) * 100)}%` : '0%' };
        }).sort((a, b) => parseInt(b.rate) - parseInt(a.rate));

        const result = JSON.stringify({
            date: targetDate,
            students: { total: studentsSnap.size, main: mainCount, reserve: reserveCount },
            halaqat: { total: halaqatSnap.size, names: Object.values(halaqaNames) },
            attendance: { present: todayPresent, absent: todayAbsent, excused: todayExcused, rate: `${rate}%` },
            halaqa_comparison: halaqaComparison,
            unrecorded_halaqat: unrecorded,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الإحصائيات" });
    }
}

// ─── Tool: get_academy_alerts (Admin) ───
async function tool_get_academy_alerts({ period = 'month' } = {}) {
    const ck = `academy_alerts_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end } = getDateRange(period);

    try {
        const [overview, monthAttSnap, demotionSnap] = await Promise.all([
            tool_get_academy_overview({ date: getTodayStr() }).then(JSON.parse),
            db.collection('attendance').where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('demotion_alerts').orderBy('createdAt', 'desc').limit(10).get(),
        ]);

        const alerts = [];

        // Unrecorded halaqat
        if (overview.unrecorded_halaqat?.length > 0) {
            alerts.push({ level: "⚠️", message: `حلقات لم تحضّر اليوم: ${overview.unrecorded_halaqat.join('، ')}` });
        }

        // Low attendance
        if (parseInt(overview.attendance?.rate) < 60 && (overview.attendance?.present + overview.attendance?.absent) > 0) {
            alerts.push({ level: "⚠️", message: `نسبة الحضور منخفضة: ${overview.attendance.rate}` });
        }

        // Monthly top absentees
        const studentMap = {};
        const monthlyAbs = {};
        const studentsSnap = await db.collection('students').get();
        studentsSnap.forEach(doc => { studentMap[doc.id] = doc.data().fullName || '?'; });

        monthAttSnap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'absent') {
                monthlyAbs[d.studentId] = (monthlyAbs[d.studentId] || 0) + 1;
            }
        });

        Object.entries(monthlyAbs)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .filter(([, count]) => count >= 4)
            .forEach(([sid, count]) => {
                alerts.push({ level: "🔴", message: `${studentMap[sid] || '?'} غاب ${count} مرات — يحتاج تدخل` });
            });

        // Demotions
        const demotions = [];
        demotionSnap.forEach(doc => {
            const d = doc.data();
            demotions.push(`${d.studentName || '?'}: ${d.reason || 'غياب متكرر'}`);
        });
        if (demotions.length > 0) {
            alerts.push({ level: "📋", message: `حالات نقل: ${demotions.join(' | ')}` });
        }

        if (alerts.length === 0) {
            alerts.push({ level: "✅", message: "لا توجد تنبيهات — أداء الأكاديمية ممتاز اليوم!" });
        }

        const result = JSON.stringify({ alerts });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب التنبيهات" });
    }
}

// ─── Tool: get_academy_exams_and_behavior (Admin) ───
async function tool_get_academy_exams_and_behavior({ period = 'month' } = {}) {
    const ck = `academy_eb_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        // Build month keys for the requested period
        const periodStart = new Date(start);
        const periodEnd = new Date(end);
        const monthKeys = [];
        const cursor = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
        while (cursor <= periodEnd) {
            monthKeys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const [examsSnap, behaviorSnap] = await Promise.all([
            monthKeys.length > 0
                ? db.collection('exams').where('monthKey', 'in', monthKeys.slice(0, 30)).get()
                : Promise.resolve({ forEach: () => { }, size: 0 }),
            db.collection('behavior_records').orderBy('createdAt', 'desc').limit(15).get(),
        ]);

        // Exams by type
        const examsByType = {};
        examsSnap.forEach(doc => {
            const d = doc.data();
            const type = d.type === 'quran-oral' ? 'شفهي' : d.type === 'tajweed-written' ? 'تحريري' : 'قاعدة';
            if (!examsByType[type]) examsByType[type] = { count: 0, total: 0 };
            examsByType[type].count++;
            examsByType[type].total += Number(d.score || 0);
        });

        const exams = Object.entries(examsByType).map(([type, s]) => ({
            type, count: s.count, avg: `${Math.round(s.total / s.count)}/50`,
        }));

        // Behavior
        let positive = 0, negative = 0;
        behaviorSnap.forEach(doc => { if (doc.data().isPositive) positive++; else negative++; });

        const result = JSON.stringify({
            period: label,
            exams: { total: examsSnap.size, by_type: exams },
            behavior: { positive, negative, total: positive + negative },
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الاختبارات والسلوك" });
    }
}

// ─── Tool: get_top_absent_students (Admin) ───
async function tool_get_top_absent_students({ period = 'year', limit = '10' } = {}) {
    const parsedLimit = parseInt(limit) || 10;
    const ck = `top_absent_${period}_${parsedLimit}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        const [studentsSnap, attSnap] = await Promise.all([
            db.collection('students').get(),
            db.collection('attendance').where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        const studentMap = {};
        const studentHalaqa = {};
        studentsSnap.forEach(doc => {
            const d = doc.data();
            studentMap[doc.id] = d.fullName || d.name || '?';
            studentHalaqa[doc.id] = d.halaqaName || 'غير محدد';
        });

        const absCount = {};
        const totalCount = {};
        attSnap.forEach(doc => {
            const d = doc.data();
            totalCount[d.studentId] = (totalCount[d.studentId] || 0) + 1;
            if (d.status === 'absent') absCount[d.studentId] = (absCount[d.studentId] || 0) + 1;
        });

        const ranked = Object.entries(absCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, parsedLimit)
            .map(([sid, count], i) => ({
                rank: i + 1,
                name: studentMap[sid] || '?',
                halaqa: studentHalaqa[sid] || '?',
                absent_days: count,
                total_days: totalCount[sid] || count,
                absence_rate: `${Math.round((count / (totalCount[sid] || 1)) * 100)}%`,
            }));

        const result = JSON.stringify({
            period: label,
            total_students_with_absence: Object.keys(absCount).length,
            top_absent: ranked,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب ترتيب الغياب" });
    }
}

// ═══════════════════════════════════════════════
// NEW TOOL IMPLEMENTATIONS — Student Tools
// ═══════════════════════════════════════════════

// ─── Tool: get_student_sard_progress ───
async function tool_get_student_sard_progress({ student_id }) {
    const ck = `sard_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const [studentDoc, bookingSnap] = await Promise.all([
            db.collection('students').doc(student_id).get(),
            db.collection('sard_bookings')
                .where('studentId', '==', student_id)
                .where('status', '==', 'confirmed')
                .orderBy('date', 'desc')
                .limit(1)
                .get(),
        ]);

        if (!studentDoc.exists) return JSON.stringify({ error: "الطالب غير موجود" });

        const s = studentDoc.data();
        const sardList = Array.isArray(s.sard) ? s.sard : [];
        const totalJuz = 30;
        const completedCount = sardList.length;
        const percentage = Math.round((completedCount / totalJuz) * 100);

        let nextBooking = null;
        if (!bookingSnap.empty) {
            const b = bookingSnap.docs[0].data();
            nextBooking = { date: b.date, slot: b.slot || null, status: b.status };
        }

        const result = JSON.stringify({
            name: s.fullName || s.name,
            completed_parts: completedCount,
            total_parts: totalJuz,
            percentage: `${percentage}%`,
            parts_list: sardList,
            next_booking: nextBooking,
            advice: completedCount === 0 ? 'لم تبدأ بالسرد بعد — سجّل حجزك!' :
                completedCount >= 25 ? `ما شاء الله! بقي ${totalJuz - completedCount} أجزاء فقط 🌟` :
                    `أكملت ${completedCount} جزء — واصل! 💪`
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب بيانات السرد" });
    }
}

// ─── Tool: get_student_exams ───
async function tool_get_student_exams({ student_id }) {
    const ck = `exams_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const snap = await db.collection('exams')
            .where('studentId', '==', student_id)
            .get();

        const exams = [];
        snap.forEach(doc => exams.push(doc.data()));
        exams.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        if (exams.length === 0) return JSON.stringify({ message: "لا توجد اختبارات مسجلة" });

        const byType = {};
        exams.forEach(e => {
            const type = e.type === 'quran-oral' ? 'شفهي' : e.type === 'tajweed-written' ? 'تحريري' : 'قاعدة';
            if (!byType[type]) byType[type] = { scores: [], count: 0 };
            byType[type].scores.push(Number(e.score || 0));
            byType[type].count++;
        });

        const averages = Object.entries(byType).map(([type, data]) => ({
            type,
            count: data.count,
            avg: `${Math.round(data.scores.reduce((a, b) => a + b, 0) / data.count)}/50`,
            latest: data.scores[0],
        }));

        const result = JSON.stringify({
            total_exams: exams.length,
            by_type: averages,
            latest: exams.slice(0, 5).map(e => ({
                type: e.type === 'quran-oral' ? 'شفهي' : e.type === 'tajweed-written' ? 'تحريري' : 'قاعدة',
                score: `${e.score}/50`,
                title: e.title || '',
                date: e.date,
            })),
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الاختبارات" });
    }
}

// ─── Tool: get_student_behavior ───
async function tool_get_student_behavior({ student_id }) {
    const ck = `behavior_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const [studentDoc, behaviorSnap] = await Promise.all([
            db.collection('students').doc(student_id).get(),
            db.collection('behavior_records')
                .where('studentId', '==', student_id)
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get(),
        ]);

        const behaviorPoints = studentDoc.exists ? (studentDoc.data().behaviorPoints || 0) : 0;

        let positive = 0, negative = 0;
        const recent = [];
        behaviorSnap.forEach(doc => {
            const d = doc.data();
            if (d.isPositive) positive++; else negative++;
            if (recent.length < 5) {
                recent.push({
                    type: d.isPositive ? 'إيجابي 👍' : 'سلبي 👎',
                    category: d.category,
                    note: d.note || null,
                    date: d.date || null,
                });
            }
        });

        const result = JSON.stringify({
            behavior_points: behaviorPoints,
            positive_count: positive,
            negative_count: negative,
            net_score: positive - negative,
            recent_records: recent,
            assessment: positive > negative * 2 ? 'سلوك ممتاز! 🌟' :
                positive > negative ? 'سلوك جيد 👍' :
                    negative > positive ? 'يحتاج تحسين ⚠️' : 'متوازن',
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب سجل السلوك" });
    }
}

// ─── Tool: get_student_excuses ───
async function tool_get_student_excuses({ student_id }) {
    const ck = `excuses_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const snap = await db.collection('leave_requests')
            .where('studentId', '==', student_id)
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get();

        if (snap.empty) return JSON.stringify({ message: "لا توجد طلبات إذن" });

        const requests = [];
        snap.forEach(doc => {
            const d = doc.data();
            const statusMap = { pending: 'معلّق ⏳', approved: 'مقبول ✅', rejected: 'مرفوض ❌' };
            requests.push({
                reason: d.reason,
                status: statusMap[d.status] || d.status,
                date: d.createdAt?.toDate?.()?.toLocaleDateString('en-CA') || 'غير محدد',
                rejection_reason: d.rejectionReason || null,
            });
        });

        const pending = requests.filter(r => r.status.includes('معلّق')).length;

        const result = JSON.stringify({
            total: requests.length,
            pending_count: pending,
            requests,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب طلبات الإذن" });
    }
}

// ─── Tool: get_leaderboard ───
async function tool_get_leaderboard({ student_id }) {
    const ck = `leaderboard_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const snap = await db.collection('students')
            .where('stars', '>', 0)
            .orderBy('stars', 'desc')
            .limit(10)
            .get();

        const top10 = [];
        let myRank = null;
        let rank = 0;

        snap.forEach(doc => {
            rank++;
            const d = doc.data();
            top10.push({
                rank,
                name: d.fullName || d.name || '?',
                stars: d.stars || 0,
            });
            if (doc.id === student_id) myRank = rank;
        });

        // If student not in top 10, find their rank
        if (!myRank) {
            const studentDoc = await db.collection('students').doc(student_id).get();
            if (studentDoc.exists) {
                const myStars = studentDoc.data().stars || 0;
                const aboveMe = await db.collection('students')
                    .where('stars', '>', myStars)
                    .get();
                myRank = aboveMe.size + 1;
            }
        }

        const result = JSON.stringify({
            top_10: top10,
            my_rank: myRank || 'غير مصنّف',
            my_stars: top10.find(t => t.rank === myRank)?.stars || null,
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب لوحة الشرف" });
    }
}

// ─── Tool: get_student_certificates ───
async function tool_get_student_certificates({ student_id }) {
    const ck = `certs_${student_id}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const snap = await db.collection('certificates')
            .where('studentId', '==', student_id)
            .get();

        const certs = [];
        snap.forEach(doc => {
            const d = doc.data();
            certs.push({ title: d.title, date: d.date || null });
        });
        certs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        const result = JSON.stringify({
            total: certs.length,
            certificates: certs,
            message: certs.length === 0 ? 'لا توجد شهادات بعد — واصل التميز!' : `حصلت على ${certs.length} شهادة تكريم 🎖️`
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الشهادات" });
    }
}

// ═══════════════════════════════════════════════
// NEW TOOL IMPLEMENTATIONS — Teacher Tools
// ═══════════════════════════════════════════════

// ─── Tool: get_student_behavior_report (Teacher) ───
async function tool_get_student_behavior_report({ teacher_id, student_name }) {
    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const halaqaId = teacherDoc.data().halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "لا توجد حلقة" });

        const studentsSnap = await db.collection('students').where('halaqaId', '==', halaqaId).get();

        const studentMap = {};
        const studentIds = [];
        studentsSnap.forEach(doc => {
            studentMap[doc.id] = doc.data().fullName || doc.data().name || '?';
            studentIds.push(doc.id);
        });

        // If specific student requested, filter
        if (student_name) {
            const searchLower = student_name.toLowerCase().trim();
            const filtered = studentIds.filter(id =>
                studentMap[id].toLowerCase().includes(searchLower)
            );
            if (filtered.length === 0) return JSON.stringify({ error: `لم أجد طالب باسم "${student_name}"` });

            // Get behavior for matched students
            const behaviorSnap = await db.collection('behavior_records')
                .where('studentId', 'in', filtered.slice(0, 10))
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();

            const records = [];
            behaviorSnap.forEach(doc => {
                const d = doc.data();
                records.push({
                    student: d.studentName || studentMap[d.studentId] || '?',
                    type: d.isPositive ? 'إيجابي 👍' : 'سلبي 👎',
                    category: d.category,
                    note: d.note || null,
                    date: d.date || null,
                });
            });

            return JSON.stringify({ student: student_name, records, total: records.length });
        }

        // All halaqa students behavior summary
        const summaryIds = studentIds.slice(0, 10);
        const behaviorSnap = summaryIds.length > 0
            ? await db.collection('behavior_records')
                .where('studentId', 'in', summaryIds)
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get()
            : { forEach: () => { } };

        const perStudent = {};
        behaviorSnap.forEach(doc => {
            const d = doc.data();
            if (!perStudent[d.studentId]) perStudent[d.studentId] = { name: studentMap[d.studentId] || '?', positive: 0, negative: 0 };
            if (d.isPositive) perStudent[d.studentId].positive++; else perStudent[d.studentId].negative++;
        });

        const summary = Object.values(perStudent).map(s => ({
            name: s.name,
            positive: s.positive,
            negative: s.negative,
            assessment: s.negative > s.positive ? '⚠️' : '✅',
        }));

        const needsAttention = summary.filter(s => s.assessment === '⚠️');

        return JSON.stringify({
            halaqa_summary: summary,
            needs_attention: needsAttention,
            students_with_records: summary.length,
            total_students: studentIds.length,
        });
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب تقرير السلوك" });
    }
}

// ─── Tool: get_halaqa_attendance_comparison (Teacher) ───
async function tool_get_halaqa_attendance_comparison({ teacher_id, period = 'month' }) {
    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const halaqaId = teacherDoc.data().halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "لا توجد حلقة" });

        const { start, end, label } = getDateRange(period);

        const attSnap = await db.collection('attendance')
            .where('halaqaId', '==', halaqaId)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();

        const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const byDay = {};
        dayNames.forEach(d => { byDay[d] = { present: 0, absent: 0, total: 0 }; });

        attSnap.forEach(doc => {
            const d = doc.data();
            const dateObj = new Date(d.date);
            const dayName = dayNames[dateObj.getDay()];
            byDay[dayName].total++;
            if (d.status === 'present' || d.status === 'sard') byDay[dayName].present++;
            else if (d.status === 'absent') byDay[dayName].absent++;
        });

        const comparison = Object.entries(byDay)
            .filter(([, s]) => s.total > 0)
            .map(([day, s]) => ({
                day,
                present: s.present,
                absent: s.absent,
                total: s.total,
                attendance_rate: `${Math.round((s.present / s.total) * 100)}%`,
            }))
            .sort((a, b) => parseInt(b.attendance_rate) - parseInt(a.attendance_rate));

        const worstDay = comparison.length > 0 ? comparison[comparison.length - 1] : null;
        const bestDay = comparison.length > 0 ? comparison[0] : null;

        return JSON.stringify({
            period: label,
            by_day: comparison,
            best_day: bestDay ? `${bestDay.day} (${bestDay.attendance_rate})` : null,
            worst_day: worstDay ? `${worstDay.day} (${worstDay.attendance_rate})` : null,
        });
    } catch (e) {
        return JSON.stringify({ error: "فشل مقارنة الحضور" });
    }
}

// ─── Tool: get_halaqa_announcements (Teacher) ───
async function tool_get_halaqa_announcements({ teacher_id }) {
    try {
        const teacherDoc = await db.collection('users').doc(teacher_id).get();
        if (!teacherDoc.exists) return JSON.stringify({ error: "المعلم غير موجود" });

        const halaqaId = teacherDoc.data().halaqaId;
        if (!halaqaId) return JSON.stringify({ error: "لا توجد حلقة" });

        const snap = await db.collection('announcements')
            .where('halaqaId', '==', halaqaId)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();

        if (snap.empty) return JSON.stringify({ message: "لا توجد إعلانات" });

        const announcements = [];
        snap.forEach(doc => {
            const d = doc.data();
            announcements.push({
                text: d.text,
                teacher: d.teacherName || '',
                date: d.date || null,
            });
        });

        return JSON.stringify({ total: announcements.length, announcements });
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب الإعلانات" });
    }
}

// ═══════════════════════════════════════════════
// NEW TOOL IMPLEMENTATIONS — Admin Tools
// ═══════════════════════════════════════════════

// ─── Tool: get_leave_requests (Admin) ───
async function tool_get_leave_requests({ status = 'all' } = {}) {
    const ck = `leave_${status}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        let query = db.collection('leave_requests').orderBy('createdAt', 'desc').limit(20);
        if (status && status !== 'all') {
            query = db.collection('leave_requests').where('status', '==', status).orderBy('createdAt', 'desc').limit(20);
        }

        const snap = await query.get();

        let pending = 0, approved = 0, rejected = 0;
        const requests = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d.status === 'pending') pending++;
            else if (d.status === 'approved') approved++;
            else if (d.status === 'rejected') rejected++;

            requests.push({
                student: d.studentName || '?',
                reason: d.reason,
                status: d.status === 'pending' ? 'معلّق ⏳' : d.status === 'approved' ? 'مقبول ✅' : 'مرفوض ❌',
                date: d.createdAt?.toDate?.()?.toLocaleDateString('en-CA') || 'غير محدد',
            });
        });

        const result = JSON.stringify({
            summary: { pending, approved, rejected, total: requests.length },
            requests: requests.slice(0, 10),
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب طلبات الإذن" });
    }
}

// ─── Tool: get_sard_overview (Admin) ───
async function tool_get_sard_overview() {
    const ck = `sard_overview`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const studentsSnap = await db.collection('students').get();

        let studentsWithSard = 0;
        let totalParts = 0;
        const topSardists = [];

        studentsSnap.forEach(doc => {
            const d = doc.data();
            const sardList = Array.isArray(d.sard) ? d.sard : [];
            if (sardList.length > 0) {
                studentsWithSard++;
                totalParts += sardList.length;
                topSardists.push({
                    name: d.fullName || d.name || '?',
                    parts: sardList.length,
                    halaqa: d.halaqaName || 'غير محدد',
                });
            }
        });

        topSardists.sort((a, b) => b.parts - a.parts);

        const result = JSON.stringify({
            total_students: studentsSnap.size,
            students_with_sard: studentsWithSard,
            total_parts_completed: totalParts,
            completion_rate: `${Math.round((studentsWithSard / Math.max(studentsSnap.size, 1)) * 100)}%`,
            top_sardists: topSardists.slice(0, 10),
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب إحصائيات السرد" });
    }
}

// ─── Tool: get_student_management_info (Admin) ───
async function tool_get_student_management_info({ student_name }) {
    try {
        const studentsSnap = await db.collection('students').get();
        const searchLower = student_name.toLowerCase().trim();
        const searchWords = searchLower.split(/\s+/).filter(w => w.length > 1);
        const isNumeric = /^\d+$/.test(searchLower);

        const matches = [];
        studentsSnap.forEach(doc => {
            const d = doc.data();
            const name = (d.fullName || d.name || '').toLowerCase();
            const nationalId = (d.nationalId || '').toLowerCase();
            const phone = (d.parentPhone || '').toLowerCase();
            const code = (d.code || '').toLowerCase();
            const docId = doc.id.toLowerCase();
            const birthDate = (d.birthDate || '').toLowerCase();

            let matched = false;

            if (docId === searchLower) matched = true;
            else if (code && (code === searchLower || code.includes(searchLower))) matched = true;
            else if (isNumeric && nationalId && nationalId.includes(searchLower)) matched = true;
            else if (isNumeric && phone && phone.includes(searchLower)) matched = true;
            else if (birthDate && birthDate.includes(searchLower)) matched = true;
            else if (name.includes(searchLower)) matched = true;
            else if (searchWords.length >= 2 && searchWords.every(w => name.includes(w))) matched = true;

            if (matched) {
                matches.push({ data: d, id: doc.id });
            }
        });

        if (matches.length === 0) return JSON.stringify({ error: `لم أجد طالب يطابق "${student_name}"` });

        if (matches.length > 3) {
            return JSON.stringify({
                multiple: true,
                message: `وجدت ${matches.length} طلاب مطابقين للبحث، أي منهم تقصد؟`,
                students: matches.slice(0, 10).map(m => ({
                    id: m.id,
                    name: m.data.fullName || m.data.name,
                    halaqa: m.data.halaqaName || 'غير محدد',
                })),
            });
        }

        // For 1-3 matches, return full info
        const results = [];
        for (const match of matches) {
            const sid = match.id;
            const s = match.data;

            const { start, end } = getDateRange('year');
            const [attSnap, progSnap] = await Promise.all([
                db.collection('attendance').where('studentId', '==', sid).where('date', '>=', start).where('date', '<=', end).get(),
                db.collection('progress').where('studentId', '==', sid).where('date', '>=', start).where('date', '<=', end).get(),
            ]);

            let present = 0, absent = 0;
            attSnap.forEach(doc => {
                const d = doc.data();
                if (d.status === 'present' || d.status === 'sard') present++;
                else if (d.status === 'absent') absent++;
            });

            let avgTotal = 0;
            const progs = [];
            progSnap.forEach(doc => progs.push(doc.data()));
            if (progs.length > 0) {
                const sum = progs.reduce((acc, p) =>
                    acc + Number(p.lessonScore || 0) + Number(p.revisionScore || 0) + Number(p.tilawaScore || 0) + Number(p.homeworkScore || 0), 0);
                avgTotal = Math.round(sum / progs.length * 10) / 10;
            }

            const sardList = Array.isArray(s.sard) ? s.sard : [];

            results.push({
                student_id: sid,
                name: s.fullName || s.name,
                type: s.type === 'reserve' ? 'احتياط' : 'أساسي',
                halaqa: s.halaqaName || 'غير محدد',
                national_id: s.nationalId || null,
                parent_phone: s.parentPhone || null,
                stars: s.stars || 0,
                behavior_points: s.behaviorPoints || 0,
                sard_parts: sardList.length,
                attendance: { present, absent, rate: present + absent > 0 ? `${Math.round((present / (present + absent)) * 100)}%` : 'لا بيانات' },
                scores: { sessions: progs.length, avg: `${avgTotal}/40` },
            });
        }

        return JSON.stringify(results.length === 1 ? results[0] : { students: results });
    } catch (e) {
        return JSON.stringify({ error: "فشل البحث عن الطالب" });
    }
}

// ─── Tool: get_halaqat_comparison (Admin) ───
async function tool_get_halaqat_comparison({ period = 'month' } = {}) {
    const ck = `halaqat_cmp_${period}`;
    const cached = getCached(ck);
    if (cached) return cached;

    const { start, end, label } = getDateRange(period);

    try {
        const [halaqatSnap, studentsSnap, attSnap, progressSnap] = await Promise.all([
            db.collection('halaqat').get(),
            db.collection('students').get(),
            db.collection('attendance').where('date', '>=', start).where('date', '<=', end).get(),
            db.collection('progress').where('date', '>=', start).where('date', '<=', end).get(),
        ]);

        const halaqaInfo = {};
        halaqatSnap.forEach(doc => {
            halaqaInfo[doc.id] = { name: doc.data().name || doc.id, students: 0, present: 0, absent: 0, totalScores: 0, scoreCount: 0 };
        });

        studentsSnap.forEach(doc => {
            const hId = doc.data().halaqaId;
            if (hId && halaqaInfo[hId]) halaqaInfo[hId].students++;
        });

        attSnap.forEach(doc => {
            const d = doc.data();
            const hId = d.halaqaId;
            if (hId && halaqaInfo[hId]) {
                if (d.status === 'present' || d.status === 'sard') halaqaInfo[hId].present++;
                else if (d.status === 'absent') halaqaInfo[hId].absent++;
            }
        });

        progressSnap.forEach(doc => {
            const d = doc.data();
            const hId = d.halaqaId;
            if (hId && halaqaInfo[hId]) {
                const total = Number(d.lessonScore || 0) + Number(d.revisionScore || 0) + Number(d.tilawaScore || 0) + Number(d.homeworkScore || 0);
                halaqaInfo[hId].totalScores += total;
                halaqaInfo[hId].scoreCount++;
            }
        });

        const comparison = Object.values(halaqaInfo)
            .filter(h => h.students > 0)
            .map(h => {
                const totalAtt = h.present + h.absent;
                return {
                    name: h.name,
                    students: h.students,
                    attendance_rate: totalAtt > 0 ? `${Math.round((h.present / totalAtt) * 100)}%` : 'لا بيانات',
                    avg_score: h.scoreCount > 0 ? `${Math.round(h.totalScores / h.scoreCount * 10) / 10}/40` : 'لا بيانات',
                    total_sessions: h.scoreCount,
                };
            })
            .sort((a, b) => parseInt(b.attendance_rate) - parseInt(a.attendance_rate));

        const result = JSON.stringify({
            period: label,
            halaqat: comparison,
            best: comparison[0]?.name || null,
            needs_improvement: comparison.filter(h => parseInt(h.attendance_rate) < 70).map(h => h.name),
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل مقارنة الحلقات" });
    }
}

// ─── Tool: get_behavior_overview (Admin) ───
async function tool_get_behavior_overview({ period = 'month', limit = '10' } = {}) {
    const ck = `behavior_overview_${period}_${limit}`;
    const cached = getCached(ck);
    if (cached) return cached;

    try {
        const { start, end, label } = getDateRange(period);
        const maxResults = Math.min(parseInt(limit) || 10, 30);

        // Get behavior records in the period
        const behaviorSnap = await db.collection('behavior_records')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();

        if (behaviorSnap.empty) return JSON.stringify({ message: "لا توجد سجلات سلوك في هذه الفترة", period: label });

        const perStudent = {};
        let totalPositive = 0, totalNegative = 0;

        behaviorSnap.forEach(doc => {
            const d = doc.data();
            const sid = d.studentId;
            if (!perStudent[sid]) {
                perStudent[sid] = {
                    name: d.studentName || '?',
                    halaqa: d.halaqaName || 'غير محدد',
                    positive: 0,
                    negative: 0,
                    categories: {},
                };
            }
            if (d.isPositive) { perStudent[sid].positive++; totalPositive++; }
            else { perStudent[sid].negative++; totalNegative++; }

            // Track categories
            const cat = d.category || 'أخرى';
            perStudent[sid].categories[cat] = (perStudent[sid].categories[cat] || 0) + 1;
        });

        const students = Object.values(perStudent);

        // Sort by most negative behavior
        const worstBehavior = [...students]
            .filter(s => s.negative > 0)
            .sort((a, b) => b.negative - a.negative)
            .slice(0, maxResults)
            .map(s => ({
                name: s.name,
                halaqa: s.halaqa,
                negative: s.negative,
                positive: s.positive,
                top_category: Object.entries(s.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
            }));

        // Sort by most positive behavior
        const bestBehavior = [...students]
            .filter(s => s.positive > 0)
            .sort((a, b) => b.positive - a.positive)
            .slice(0, 5)
            .map(s => ({ name: s.name, halaqa: s.halaqa, positive: s.positive }));

        const result = JSON.stringify({
            period: label,
            total_records: behaviorSnap.size,
            total_positive: totalPositive,
            total_negative: totalNegative,
            students_with_records: students.length,
            worst_behavior: worstBehavior,
            best_behavior: bestBehavior,
            advice: totalNegative > totalPositive ? '⚠️ السلوكيات السلبية أكثر — يحتاج تدخل' : '✅ السلوك العام إيجابي',
        });
        setCache(ck, result);
        return result;
    } catch (e) {
        return JSON.stringify({ error: "فشل جلب نظرة السلوك" });
    }
}

// ─── Tool Router ───
const TOOL_HANDLERS = {
    // Common
    get_student_info: tool_get_student_info,
    get_attendance: tool_get_attendance,
    get_scores: tool_get_scores,
    // Student
    get_student_sard_progress: tool_get_student_sard_progress,
    get_student_exams: tool_get_student_exams,
    get_student_behavior: tool_get_student_behavior,
    get_student_excuses: tool_get_student_excuses,
    get_leaderboard: tool_get_leaderboard,
    get_student_certificates: tool_get_student_certificates,
    // Teacher
    get_halaqa_overview: tool_get_halaqa_overview,
    get_halaqa_scores_and_behavior: tool_get_halaqa_scores_and_behavior,
    search_student_by_name: tool_search_student_by_name,
    get_smart_alerts: tool_get_smart_alerts,
    get_student_behavior_report: tool_get_student_behavior_report,
    get_halaqa_attendance_comparison: tool_get_halaqa_attendance_comparison,
    get_halaqa_announcements: tool_get_halaqa_announcements,
    // Admin
    get_academy_overview: tool_get_academy_overview,
    get_academy_alerts: tool_get_academy_alerts,
    get_academy_exams_and_behavior: tool_get_academy_exams_and_behavior,
    get_top_absent_students: tool_get_top_absent_students,
    get_leave_requests: tool_get_leave_requests,
    get_sard_overview: tool_get_sard_overview,
    get_student_management_info: tool_get_student_management_info,
    get_halaqat_comparison: tool_get_halaqat_comparison,
    get_behavior_overview: tool_get_behavior_overview,
};

// ═══════════════════════════════════════════════
// GROQ API — with retry + function call loop
// ═══════════════════════════════════════════════

async function callGroq(messages, tools, maxRetries = 2) {
    const body = {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages,
        temperature: 0.4,
        max_tokens: 2048,
    };

    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
    } else {
        body.response_format = { type: 'json_object' };
    }

    const totalKeys = GROQ_API_KEYS.length;
    const maxKeyAttempts = totalKeys; // try ALL keys if needed

    for (let keyAttempt = 0; keyAttempt < maxKeyAttempts; keyAttempt++) {
        const apiKey = getNextKey();
        if (!apiKey) return { success: false, error: 'No API keys configured' };

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(body),
                });

                const data = await res.json();

                if (res.ok) return { success: true, data };

                // Rate limit OR model blocked/forbidden → try next key immediately
                if ((res.status === 429 || res.status === 403) && totalKeys > 1) {
                    console.warn(`⚡ Key #${(_keyIndex - 1) % totalKeys + 1} error ${res.status}, switching to next key...`);
                    break; // break inner retry loop → go to next key
                }

                // Server error → retry same key
                if (res.status >= 500 && attempt < maxRetries) {
                    const wait = Math.pow(2, attempt + 1) * 1000;
                    console.warn(`⏳ Groq ${res.status}, retry in ${wait}ms...`);
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }

                return { success: false, error: data.error?.message || JSON.stringify(data.error) || `HTTP ${res.status}` };
            } catch (err) {
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                // Network error → try next key
                if (totalKeys > 1 && keyAttempt < maxKeyAttempts - 1) break;
                return { success: false, error: err.message };
            }
        }
    }
    return { success: false, error: 'All API keys exhausted' };
}

// ═══════════════════════════════════════════════
// HANDLER — Function Calling Loop
// ═══════════════════════════════════════════════

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (GROQ_API_KEYS.length === 0) return res.status(500).json({ error: 'No GROQ API keys configured' });

    const { message, role, studentId, teacherId, history } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message is required' });

    // Input validation
    const safeMessage = message.slice(0, 2000); // limit message length
    const validRoles = ['student', 'teacher', 'admin', 'parent'];
    const safeRole = validRoles.includes(role) ? role : 'student';
    if (studentId && typeof studentId !== 'string') return res.status(400).json({ error: 'Invalid studentId' });
    if (teacherId && typeof teacherId !== 'string') return res.status(400).json({ error: 'Invalid teacherId' });

    // For parent role, resolve child's studentId
    let resolvedStudentId = studentId;
    if (safeRole === 'parent' && !studentId) {
        try {
            const parentDoc = await db.collection('users').doc(teacherId || '').get();
            if (parentDoc.exists) {
                const pd = parentDoc.data();
                resolvedStudentId = pd.studentId || pd.childId || (Array.isArray(pd.childrenIds) ? pd.childrenIds[0] : null);
            }
        } catch (_) { /* fallback to null */ }
    }

    try {
        const systemPrompt = PROMPTS[safeRole] || PROMPTS.student;
        const tools = getToolsForRole(safeRole);

        // Inject context: identity + current date/time
        const now = new Date();
        const todayDate = getTodayStr();
        const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const dayName = dayNames[now.getDay()];
        const timeStr = now.toLocaleTimeString('ar-SA', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });

        let identityHint = `\n[التاريخ: ${todayDate} (${dayName}) | الوقت: ${timeStr}]`;
        if (safeRole === 'student' && studentId) identityHint += `\n[معرّف الطالب: ${studentId}]`;
        else if (safeRole === 'teacher' && (teacherId || studentId)) identityHint += `\n[معرّف المعلم: ${teacherId || studentId}]`;
        else if (safeRole === 'admin') identityHint += `\n[مدير الأكاديمية]`;
        else if (safeRole === 'parent' && resolvedStudentId) identityHint += `\n[ولي أمر الطالب | معرّف الطالب: ${resolvedStudentId}]`;

        // Build messages
        const messages = [
            { role: 'system', content: systemPrompt + identityHint }
        ];

        // Add history (last 12)
        if (history && Array.isArray(history)) {
            for (const h of history.slice(-16)) {
                messages.push({
                    role: h.role === 'user' ? 'user' : 'assistant',
                    content: h.text || ''
                });
            }
        }

        messages.push({ role: 'user', content: safeMessage });

        console.log(`🤖 [${safeRole}] "${safeMessage.substring(0, 60)}" | Tools: ${tools.length}`);

        // ── Function Calling Loop (max 3 rounds) ──
        let finalResponse = null;

        for (let round = 0; round < 3; round++) {
            const result = await callGroq(messages, round === 0 ? tools : tools);
            if (!result.success) {
                return res.status(500).json({ error: 'Groq API error', details: result.error });
            }

            const choice = result.data.choices?.[0];
            const msg = choice?.message;

            if (!msg) {
                return res.status(500).json({ error: 'Empty response from AI' });
            }

            // If AI wants to call tools
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                console.log(`🔧 Round ${round + 1}: ${msg.tool_calls.length} tool call(s): ${msg.tool_calls.map(t => t.function.name).join(', ')}`);

                // Add assistant message with tool calls
                messages.push(msg);

                // Execute all tool calls in parallel for better performance
                const toolPromises = msg.tool_calls.map(async (toolCall) => {
                    const fn = toolCall.function;
                    const handler_fn = TOOL_HANDLERS[fn.name];

                    let toolResult;
                    if (handler_fn) {
                        let args = {};
                        try { args = JSON.parse(fn.arguments || '{}') || {}; } catch { args = {}; }

                        // Auto-inject IDs the AI might not have
                        const effectiveStudentId = resolvedStudentId || studentId;
                        const effectiveTeacherId = teacherId || studentId;

                        if (!fn.name.startsWith('get_academy') && !fn.name.startsWith('get_leave') && !fn.name.startsWith('get_sard_overview') && !fn.name.startsWith('get_halaqat')) {
                            // Student-facing tools: inject student_id
                            const needsStudentId = ['get_student_info', 'get_attendance', 'get_scores', 'get_student_sard_progress', 'get_student_exams', 'get_student_behavior', 'get_student_excuses', 'get_leaderboard', 'get_student_certificates'];
                            if (needsStudentId.includes(fn.name) && !args.student_id && effectiveStudentId) {
                                args.student_id = effectiveStudentId;
                            }
                            // Teacher-facing tools: inject teacher_id
                            const needsTeacherId = ['get_halaqa_overview', 'get_halaqa_scores_and_behavior', 'search_student_by_name', 'get_smart_alerts', 'get_student_behavior_report', 'get_halaqa_attendance_comparison', 'get_halaqa_announcements'];
                            if (needsTeacherId.includes(fn.name) && !args.teacher_id && effectiveTeacherId) {
                                args.teacher_id = effectiveTeacherId;
                            }
                        }

                        toolResult = await handler_fn(args);
                    } else {
                        toolResult = JSON.stringify({ error: `Unknown tool: ${fn.name}` });
                    }

                    return {
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: toolResult,
                    };
                });

                const toolResults = await Promise.all(toolPromises);
                messages.push(...toolResults);

                // Continue loop — Groq will process tool results
                continue;
            }

            // AI returned a final text response
            finalResponse = msg.content || '';
            break;
        }

        if (!finalResponse) {
            finalResponse = '{"reply": "عذراً، حدث خطأ. حاول مرة أخرى."}';
        }

        // Parse JSON response
        let parsed;
        try {
            parsed = JSON.parse(finalResponse);
        } catch {
            // If AI didn't return JSON, wrap it
            parsed = { reply: finalResponse };
        }

        return res.status(200).json({
            success: true,
            reply: parsed.reply || finalResponse,
        });

    } catch (error) {
        console.error('AI Chat error:', error);
        return res.status(500).json({ error: error.message });
    }
}
