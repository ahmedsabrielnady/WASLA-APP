-- WASLA weighted roadmap progress tracker
-- Applied to project "wasla" using migration roadmap_progress_tracker.
-- Public reads are enabled explicitly for the Data API; only the admin role
-- may update status/progress/test result fields.
-- The audit trigger records each milestone state change.

create table if not exists public.roadmap_milestones (
  id text primary key,
  area text not null,
  title text not null,
  description text not null,
  weight smallint not null default 1,
  progress_percent smallint not null default 0,
  status text not null default 'planned',
  test_status text not null default 'not_tested',
  sort_order integer not null,
  public_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadmap_weight_check check (weight between 1 and 10),
  constraint roadmap_progress_check check (progress_percent between 0 and 100),
  constraint roadmap_status_check check (status in ('planned','in_progress','blocked','done')),
  constraint roadmap_test_status_check check (test_status in ('not_tested','passed','failed')),
  constraint roadmap_title_check check (char_length(title) between 3 and 120),
  constraint roadmap_description_check check (char_length(description) between 3 and 500),
  constraint roadmap_done_requires_pass check (
    (status = 'done' and progress_percent = 100 and test_status = 'passed')
    or
    (status <> 'done' and progress_percent < 100)
  ),
  constraint roadmap_planned_zero_progress check (
    status <> 'planned' or progress_percent = 0
  )
);

create index if not exists roadmap_milestones_public_sort_idx
  on public.roadmap_milestones(public_visible, sort_order);
create index if not exists roadmap_milestones_area_sort_idx
  on public.roadmap_milestones(area, sort_order);

create table if not exists public.roadmap_milestone_audit (
  id bigint generated always as identity primary key,
  milestone_id text not null references public.roadmap_milestones(id) on delete cascade,
  milestone_title_snapshot text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  old_status text not null,
  new_status text not null,
  old_progress_percent smallint not null,
  new_progress_percent smallint not null,
  old_test_status text not null,
  new_test_status text not null,
  created_at timestamptz not null default now()
);

create index if not exists roadmap_milestone_audit_created_idx
  on public.roadmap_milestone_audit(created_at desc);
create index if not exists roadmap_milestone_audit_milestone_idx
  on public.roadmap_milestone_audit(milestone_id);
create index if not exists roadmap_milestone_audit_actor_idx
  on public.roadmap_milestone_audit(actor_id);

alter table public.roadmap_milestones enable row level security;
alter table public.roadmap_milestone_audit enable row level security;

create policy roadmap_public_read on public.roadmap_milestones
for select to anon using (public_visible = true);

create policy roadmap_authenticated_read on public.roadmap_milestones
for select to authenticated
using (
  public_visible = true
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

create policy roadmap_founder_update on public.roadmap_milestones
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

create policy roadmap_audit_founder_read on public.roadmap_milestone_audit
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

revoke all on table public.roadmap_milestones from public, anon, authenticated;
grant select on table public.roadmap_milestones to anon, authenticated;
grant update (status, progress_percent, test_status)
on table public.roadmap_milestones to authenticated;

revoke all on table public.roadmap_milestone_audit from public, anon, authenticated;
grant select on table public.roadmap_milestone_audit to authenticated;

create or replace function public.capture_roadmap_milestone_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();

  if old.status is distinct from new.status
     or old.progress_percent is distinct from new.progress_percent
     or old.test_status is distinct from new.test_status then
    insert into public.roadmap_milestone_audit (
      milestone_id,milestone_title_snapshot,actor_id,
      old_status,new_status,old_progress_percent,new_progress_percent,
      old_test_status,new_test_status
    )
    values (
      old.id,old.title,auth.uid(),
      old.status,new.status,old.progress_percent,new.progress_percent,
      old.test_status,new.test_status
    );
  end if;
  return new;
end;
$function$;

revoke execute on function public.capture_roadmap_milestone_update() from public, anon, authenticated;

drop trigger if exists trg_roadmap_milestone_update on public.roadmap_milestones;
create trigger trg_roadmap_milestone_update
before update of status, progress_percent, test_status
on public.roadmap_milestones
for each row execute function public.capture_roadmap_milestone_update();

insert into public.roadmap_milestones
(id,area,title,description,weight,progress_percent,status,test_status,sort_order,public_visible)
values
('foundation-rtl-pwa','تأسيس المنصة','واجهة عربية متجاوبة وتطبيق PWA','الصفحة الرئيسية والتنقل والتصميم المتجاوب ودعم التثبيت على الهاتف.',4,100,'done','passed',10,true),
('catalog-live','تأسيس المنصة','الخدمات والعروض من قاعدة البيانات','عرض الخدمات النشطة وشريط العروض من Supabase مع معالجة فشل كل مصدر بصورة مستقلة.',4,100,'done','passed',20,true),
('auth-journey','الحسابات والهوية','رحلة التسجيل والدخول واستعادة الحساب','اختبار التسجيل والتحقق من البريد وتسجيل الدخول والخروج وتحديث الجلسة وإعادة تعيين كلمة المرور بحساب اختبار.',6,60,'in_progress','not_tested',30,true),
('consent-governance','الحسابات والخصوصية','الموافقات والشروط وسياسة الخصوصية','إقرار نصوص قانونية معتمدة وتسجيل إصدار الموافقة وسحبها وربط كل غرض بنسخته.',4,35,'in_progress','not_tested',40,true),
('service-order-flow','الطلبات والتتبع','إنشاء طلب خدمة من العميل حتى قاعدة البيانات','استكمال التحقق من الخدمة والعنوان والملاحظات والموافقات ومنع التكرار ورسالة التأكيد.',6,75,'in_progress','passed',50,true),
('customer-order-history','الطلبات والتتبع','سجل طلبات العميل وتتبع حالتها','عرض حالة الطلب وتاريخه وأحداثه والتحقق من أن العميل لا يقرأ طلبات مستخدم آخر.',4,65,'in_progress','passed',60,true),
('gps-order-location','الطلبات والتتبع','تحديد GPS وحفظ موقع تنفيذ الطلب','التقاط الموقع بإذن المستخدم وحفظ الإحداثيات على الطلب مع فحص الملكية وإظهار حالة الحفظ.',4,100,'done','passed',70,true),
('preview-write-safety','الأمان والحوكمة','حماية قاعدة الإنتاج من كتابات نسخة المعاينة','تعطيل التسجيل والموافقات والطلبات وتحديث الموقع في Deploy Preview مع بقاء القراءة متاحة.',3,100,'done','passed',80,true),
('rls-provider-isolation','الأمان والحوكمة','سياسات RLS وعزل مقدمي الخدمة التجريبيين','فصل القراءة العامة عن الخاصة ومنع ظهور مقدمي الخدمة التجريبيين أو استخدامهم في حجوزات جديدة.',6,80,'in_progress','passed',90,true),
('founder-operations','إدارة المؤسس','لوحة المؤسس والتحكم في التشغيل','إدارة الطلبات والمقدمين والقطاعات والأسعار والصلاحيات وسجل العمليات بدل شاشة القراءة فقط.',7,15,'in_progress','not_tested',100,true),
('founder-account-mfa','إدارة المؤسس','تأكيد حساب المؤسس وحماية MFA','التحقق من ملكية حساب admin وتفعيل MFA واختبار الفصل بين صلاحيات المؤسس والموظفين.',5,20,'blocked','not_tested',110,true),
('roadmap-dashboard','إدارة المؤسس','خريطة إنجاز وصلة والنسبة الموزونة','قائمة علنية للبنود المتبقية مع نسبة موزونة وتحديث من حساب المؤسس وسجل تغييرات.',4,0,'planned','not_tested',120,true),
('backup-restore','الأمان والاستمرارية','نسخ احتياطي واستعادة مجرّبة','تحديد خطة نسخ منفصلة لقاعدة البيانات والملفات وتنفيذ اختبار استعادة موثق.',6,0,'blocked','not_tested',130,true),
('clinic-provider-validation','الصحة والعيادات','اعتماد الأطباء وجداول العيادات الحقيقية','استبدال بيانات الدوام التجريبية بجداول مؤكدة من العيادات واعتماد مقدم الخدمة قبل عرضه.',5,25,'blocked','not_tested',140,true),
('clinic-booking-safety','الصحة والعيادات','حجز طبي يمنع التداخل والتكرار','اختبار حجز ذري يمنع المواعيد المتداخلة والمتزامنة وسياسات الإلغاء والمدة والطابور.',5,55,'in_progress','not_tested',150,true),
('medical-private-storage','الصحة والعيادات','ملفات المريض والتقارير الطبية الخاصة','إنشاء Storage خاص وسياسات وصول دقيقة وروابط موقعة وسجل تنزيل وقراءة قبل إدخال أي ملف حقيقي.',6,0,'blocked','not_tested',160,true),
('licensed-health-partners','الصحة والعيادات','مسارات الصيدليات والمعامل والأشعة','ربط مقدمي خدمة مرخصين وموافقات مشاركة البيانات ودورة الطلب والنتيجة والتسليم.',5,0,'planned','not_tested',170,true),
('merchant-onboarding','السوق والتجار','تسجيل التاجر وإدارة الكتالوج','اعتماد التاجر وإدارة المنتجات والأسعار والتوفر والمخزون ولوحة التاجر.',5,10,'in_progress','not_tested',180,true),
('multi-item-cart','السوق والتجار','سلة متعددة المنتجات وحجز مخزون ذري','سلة وتسعير وقت الشراء وتقسيم الطلب حسب المتجر وحجز مخزون وإرجاعه عند الإلغاء.',6,20,'in_progress','not_tested',190,true),
('restaurant-fulfillment','المطاعم','قوائم المطاعم وتجهيز وتسليم الطلب','ملفات المطاعم والوجبات والإضافات وأوقات التجهيز ودورة حالة المطبخ والتسليم.',5,0,'planned','not_tested',200,true),
('payments-ledger','المال والمدفوعات','الدفع والاسترداد والعمولة والتسوية','مقدم دفع مرخص وسجل عمليات مالي وعمولات وتسويات واستردادات قابلة للتدقيق.',7,0,'planned','not_tested',210,true),
('driver-delivery','التوصيل','تعيين المندوب وتتبع الشحنة وإثبات التسليم','دورة شحنة مستقلة ونقاط استلام وتسليم وموقع المندوب وإثبات التسليم ومطابقة النقد.',7,10,'in_progress','not_tested',220,true),
('home-service-lifecycle','الصيانة والخدمات المنزلية','عرض سعر واعتماد العميل وإتمام المهمة','معاينة وعرض سعر وموافقة العميل وجدولة المهمة وإثبات إتمامها وتسويتها.',4,40,'in_progress','not_tested',230,true),
('automotive-lifecycle','السيارات','حجز وخدمات السيارات ودورة الإصلاح','توسيع خدمات الغسيل والبطارية والفلاتر إلى طلب خدمة وموعد وفني وعرض سعر وتسليم.',4,35,'in_progress','not_tested',240,true),
('education-platform','التعليم','المعلمون والحصص والطلاب وأولياء الأمور','مواد ودورات وحصص وحضور واشتراكات وضوابط موافقة وحماية بيانات القاصرين.',4,0,'planned','not_tested',250,true),
('notifications-outbox','الإشعارات والتذكير','تنبيهات الطلبات والحجوزات وإعادة المحاولة','صندوق أحداث وإشعارات داخلية وتذكير بالمواعيد وتتبع الطلب ومنع الرسائل المكررة.',5,0,'planned','not_tested',260,true),
('privacy-compliance','الالتزام والخصوصية','مراجعة قانونية واحتفاظ البيانات وطلبات الحقوق','مراجعة متطلبات البيانات الشخصية والصحية والموافقات والاحتفاظ والحذف ونقل البيانات.',6,25,'blocked','not_tested',270,true),
('regression-security','الاختبار والجودة','اختبارات كاملة وأمن وأداء وإتاحة','اختبارات عميل ومؤسس وأدوار متعددة وتزامن وحمل واستعادة وRTL وإتاحة قبل الإطلاق.',6,25,'in_progress','not_tested',280,true)
on conflict (id) do nothing;
