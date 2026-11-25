# توثيق تقوية مسارات البحث لدوال قاعدة البيانات — 25 نوفمبر 2026

## التغيير المنفذ

طُبقت migration باسم `harden_security_definer_search_paths` على مشروع Supabase الصحيح `yfgvimcqbtthnrbzbhft`.

تم تثبيت `search_path = ''` لتسع دوال `SECURITY DEFINER` كانت بحاجة إلى هذا الضبط:

- `accept_consent(text, text)`
- `admin_reset_user_password(text, text)`
- `approve_provider(uuid)`
- `current_provider_id()`
- `current_role_name()`
- `is_staff()`
- `my_order_suggestions()`
- `my_order_tracking(uuid)`
- `set_order_location(uuid, double precision, double precision, text)`

تمت مراجعة أجسام هذه الدوال بعد التعديل؛ المراجع إلى الجداول والدوال الخارجية مؤهلة بأسماء المخططات، مثل `public.orders` و`auth.uid()` و`extensions.crypt()`.

## تحقق ما بعد التنفيذ

استعلام التحقق أعاد 21 دالة `SECURITY DEFINER` قابلة للتنفيذ من `authenticated`:

- جميع الدوال الـ21 لها `search_path = ''`.
- لا توجد أي من هذه الدوال قابلة للتنفيذ من دور `anon`.
- لم تُسحب صلاحيات `EXECUTE` من المستخدم المسجل، لأن التطبيق يعتمد على RPCs محمية بفحوص هوية ودور وملكية.
- لم تتغير بيانات العملاء أو الطلبات أو مقدمي الخدمة.

## ما لم يُغلق بعد

- لا يزال Security Advisor يعرض 22 تحذيرًا عن دوال `SECURITY DEFINER` المتاحة للمستخدم المسجل. ضبط `search_path` يقلل مخاطر name shadowing، لكنه لا يغني عن اختبار صلاحيات كل دالة.
- ما زالت حماية كلمات المرور المسرّبة غير مفعلة في Supabase Auth.
- جدول `public.order_status_transitions` عليه RLS بلا سياسات مباشرة؛ لا تُضف سياسة عامة دون مراجعة سبب العزل ومسارات RPC.

## ملفات التغيير

- `supabase/live-patches/20261125_harden_security_definer_search_paths.sql`: أرشيف قابل لإعادة المراجعة للتغيير الحي.
- `tests/security-definer-search-path.test.mjs`: اختبار يمنع فقدان هذا الضبط من الأرشيف مستقبلًا.

هذا التوثيق لا يعني أن الإصدار المنشور على Vercel يتضمن آخر تغييرات المستودع؛ آخر Production deployment مؤكد وقت التوثيق كان على commit `9f52467acbe234445196ff6d7753149be35bd58b`.
