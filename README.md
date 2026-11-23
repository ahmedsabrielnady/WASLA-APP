# WASLA | وصلة

منصة خدمات محلية تبدأ من شبين القناطر، القليوبية.

## الحالة الحالية

- فرع المنتج الحالي: `app/phase-1-react-foundation`.
- قاعدة Supabase المعتمدة للتطبيق: `wasla` — `yfgvimcqbtthnrbzbhft`.
- الواجهة أصبحت تطبيق ويب/PWA عربيًا متجاوبًا، مقسمًا إلى JavaScript ES Modules ويستخدم المتصفح مباشرة، دون حزم خارجية أو خطوة build.
- الملفات القديمة حُفظت تحت `legacy/` ولم تعد تُحمّل من التطبيق الفعلي.
- `admin.html` يحوّل إلى صفحة التشغيل داخل التطبيق.

## ما يعمل في المرحلة الأولى

- تحميل الخدمات النشطة وشريط الإعلانات من Supabase.
- تسجيل مستخدم بالبريد وكلمة المرور، وإرسال الاسم ورقم الهاتف إلى بيانات المستخدم.
- تسجيل الدخول والخروج وتحديث الجلسة.
- حفظ موافقتي الشروط والخصوصية عن طريق RPC.
- إنشاء طلبات الصيانة المنزلية وخدمات السيارات فقط في الإطلاق التجريبي، مع تحديد GPS اختياري وحفظ الإحداثيات على نفس الطلب. التمريض والعيادات مؤجلان لحين استكمال متطلبات الخصوصية والبيانات الصحية.
- عرض طلبات العميل.
- صفحة تشغيل قراءة فقط للمستخدمين ذوي الدور `staff` أو `admin`.
- PWA shell cache بإصدار جديد واستراتيجية Network-first للملفات الثابتة، دون تخزين Auth أو بيانات REST.
- عزل مقدمي الخدمة التجريبيين عن الاكتشاف العام والحجوزات والتعيينات الجديدة دون حذف الحجوزات السابقة.
- GitHub Actions نجح في فحص syntax واختبارات Node على آخر نسخة من الفرع.
- تم اختبار RPC إنشاء الطلب في قاعدة البيانات داخل معاملة متراجعة؛ لم تترك بيانات اختبار.

## ما لم يُفعّل بعد

العيادات، المنتجات/المتاجر، المطاعم، التعليم، والتوصيل لا تُعامل كخدمات قابلة للشراء أو الحجز قبل تجهيز بياناتها ودورات العمل. جداول دوام الطبيب الحالية غير معتمدة حتى يتم تأكيد أنها ليست بيانات اختبار.

لا يوجد دفع إلكتروني أو محفظة أو تتبع GPS أو شحنات أو إشعارات push أو تخزين ملفات مرضى في هذه النسخة.

## التشغيل والاختبارات

لا توجد dependencies خارجية:

```bash
npm ci
npm run verify
python -m http.server 8080
```

ثم افتح `http://localhost:8080`. لا تستخدم `file://` لأن وحدات JavaScript وService Worker تحتاج HTTP أو HTTPS.

## إعداد Supabase

ملف `src/config.js` يحتوي رابط المشروع ومفتاح `publishable` العام المخصص للمتصفح. هذا المفتاح ليس سرًا، لكنه لا يمنح صلاحية بذاته؛ تعتمد حماية الصفوف على RLS وسياسات قاعدة البيانات. ممنوع وضع `service_role` أو أي secret في الواجهة أو GitHub.

## ملفات مهمة

- `src/config.js`: إعداد الاتصال العام.
- `src/supabase.js`: Auth وREST وRPC.
- `src/domain.js`: قواعد القطاعات والتحقق والتنسيق.
- `src/main.js`: واجهة التطبيق وتدفقات الاستخدام.
- `tests/domain.test.mjs`: اختبارات قواعد النطاق.
- `docs/05-phase1-application-foundation-ar.md`: حدود المرحلة وخطة العمل التالية.
- `docs/04-live-supabase-audit-ar.md`: تدقيق قاعدة Supabase الحية.

`main` لم يتغير. هذه المرحلة تعمل على فرع مستقل وتحتاج مراجعة واختبار متصفح قبل الدمج والنشر العام.


## تحسينات واختبارات 21 نوفمبر 2026

- إصلاح RLS للقراءة العامة بعد ظهور 401 في العروض.
- عزل مقدمي الخدمة التجريبيين مع الحفاظ على الحجوزات القديمة.
- تحديد GPS اختياري للطلب وحفظ الإحداثيات عبر RPC مع فحص ملكية الطلب.
- اختبار واجهة معزول 10/10 باستخدام mock backend؛ لا يستخدم حسابًا أو طلبًا حقيقيًا.
- [أرشيف فصل سياسات القراءة العامة والخاصة](supabase/live-patches/20261121_split_public_authenticated_rls.sql)
- [أرشيف عزل مقدمي الخدمة التجريبيين](supabase/live-patches/20261121_isolate_test_providers.sql)


### حماية بيئة المعاينة

رابط Deploy Preview يتصل بقاعدة `wasla` الحية للقراءة، لكن إنشاء الحسابات وحفظ الموافقات والطلبات وGPS مقفل في المعاينة. تم اختبار ذلك عبر mock harness بنتيجة 15/15. لا تستخدم بيانات حسابات حقيقية في بيئة الاختبار ولا تتوقع إنشاء طلب إنتاجي من رابط المعاينة.


## خطة الإنجاز ونسبة اكتمال وصلة

- [لوحة خطة الإنجاز الموزونة وتقرير المؤسس](docs/06-roadmap-progress-and-founder-review-ar.md)
- [أرشيف إنشاء لوحة الخطة وسجل التدقيق](supabase/live-patches/20261121_roadmap_progress_tracker.sql)
- [أرشيف تنظيف فهارس التدقيق المكررة](supabase/live-patches/20261121_remove_duplicate_roadmap_audit_indexes.sql)
- [أرشيف اعتماد اكتمال لوحة الخطة بعد الاختبار](supabase/live-patches/20261121_mark_roadmap_tracker_verified.sql)

النسبة الحالية محسوبة من 28 بندًا مجموع أوزانها 143: الإنجاز الموزون 36.7%، والاكتمال المكتمل والمجتاز للاختبار 13.3%. التعديل محصور بدور `admin`، وكل تغيير يُسجل في جدول تدقيق.


## بوابة إطلاق الصحة والخصوصية

لا تدخل بيانات مرضى أو أطفال حقيقية إلى قاعدة البيانات ولا تُرفع تقارير طبية قبل مراجعة التزامات قانون حماية البيانات المصري ولائحته التنفيذية، والحصول على أي ترخيص/تصريح مطلوب، واعتماد الموافقات الصريحة والسياسات وخطة خروقات البيانات. التفاصيل في [تقرير خطة الإنجاز ومراجعة المؤسس](docs/06-roadmap-progress-and-founder-review-ar.md).


### تحديث النسبة — 21 نوفمبر 2026

تقرير لوحة الإنجاز حدّث بعد إعادة احتساب المهام الحالية: 36.7% إنجاز موزون، و13.3% اكتمال مثبت باختبار. يحتوي التقرير على 28 بندًا، منها 23 غير مكتمل.


## تحديث دورة الطلب وCRM — 23 نوفمبر 2026

- تمت إضافة P0 idempotency ودوال دورة الطلب، ووحدة CRM أولية للموظفين والإدارة.
- تفاصيل التنفيذ والاختبارات والحدود الحالية: [تقرير P0 وCRM](docs/07-p0-crm-delivery-ar.md).
- التغييرات البرمجية في PR #9، وما زالت مسودة ولم تُدمج في main أو تُنشر إنتاجيًا.


## Release hardening — 23 November 2026

- Live CRM foreign-key indexes were applied through migration `launch_crm_fk_indexes_and_private_transition_table`.
- The order status-transition table explicitly denies direct access to `anon` and `authenticated`; authorized database RPCs access it internally.
- The public order RPC now accepts only `maintenance` and `car`; nursing and clinic requests remain disabled until health-data compliance and privacy controls are approved.
- A provider workspace now lists only the signed-in provider’s assigned orders and permits only the database-approved `confirmed → in_progress → done` flow.
- Browser writes are blocked on localhost, Netlify deploy-preview URLs, Vercel branch-preview URLs, and generic preview hosts. Only a stable non-preview deployment can write to the live database.
- This does not replace the remaining release gates: authenticated browser E2E, Auth leaked-password protection, administrator MFA, verified production-domain configuration, and a tested restore procedure.
