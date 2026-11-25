# Separate synthetic providers: user5 doctor, user6 teacher, user7 grocery merchant, user8 restaurant merchant, user3 technician, user2 staff, user1 customer.
import os,datetime
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
TK={n:login(str(n)) for n in (1,2,3,5,6,7,8)}
R=[]
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
def get(path,who):return call("/rest/v1/"+path,None,TK[who])[1]
prov={r["user_id"]:r for r in get("providers?select=id,user_id,kind,display_name",2)}
uid=lambda n:call("/auth/v1/user",None,TK[n])[1]["id"]
P={n:prov[uid(n)] for n in (3,5,6,7,8)}
print({n:P[n]["kind"] for n in P})
# --- clinic filter
docs=get("providers?select=id,kind&kind=eq.doctor&approved=eq.true&active=eq.true&is_test=eq.false",1)
chk("doctor list contains only doctors",docs and all(d["kind"]=="doctor" for d in docs) and any(d["id"]==P[5]["id"] for d in docs),[d["kind"] for d in docs])
allp=get("providers?select=kind",1);chk("unfiltered list does contain non-doctors (filter is what excludes them)",len({x["kind"] for x in allp})>1,sorted({x["kind"] for x in allp}))
# The fixture schedule has no Saturday rows (verified: 4 slots every other weekday, 0 on Saturday), so a fixed +3 days fails when it lands on a Saturday.
# Each run books one slot on its day, so a fixed day loses capacity run after run. Fresh fixture: the first non-Saturday day (+3..+30) whose slots are still at full capacity (4 per day, verified on untouched days).
day=None
for _k in range(3,31):
    _d=datetime.datetime.utcnow()+datetime.timedelta(days=_k)
    if _d.weekday()==5:continue
    _s=rpc("clinic_available_slots",{"p_provider":P[5]["id"],"p_day":_d.strftime("%Y-%m-%d")},TK[1])[1]
    if isinstance(_s,list) and len(_s)==4:day=_d.strftime("%Y-%m-%d");break
chk("a fresh full-capacity day exists in the next 30 days",day is not None,day)
_sat=datetime.datetime.utcnow()+datetime.timedelta(days=1)
while _sat.weekday()!=5:_sat+=datetime.timedelta(days=1)
sl=rpc("clinic_available_slots",{"p_provider":P[5]["id"],"p_day":day},TK[1])[1];chk("doctor has the full 4 slots on a fresh day",isinstance(sl,list) and len(sl)==4,len(sl) if isinstance(sl,list) else sl)
chk("closed day control: the doctor has no slots on a Saturday",rpc("clinic_available_slots",{"p_provider":P[5]["id"],"p_day":_sat.strftime("%Y-%m-%d")},TK[1])[1]==[],_sat.strftime("%a"))
for n in (3,6,7,8):
    r=rpc("clinic_available_slots",{"p_provider":P[n]["id"],"p_day":day},TK[1]);chk(f"slots for {P[n]['kind']} provider are empty",r[0]==200 and r[1]==[],r)
    chk(f"cannot book clinic slot with {P[n]['kind']} provider id",rpc("book_clinic_slot",{"p_provider":P[n]["id"],"p_at":sl[0]["slot"]},TK[1])[0]>=400)
st,b=rpc("book_clinic_slot",{"p_provider":P[5]["id"],"p_at":sl[0]["slot"],"p_notes":"عزل أدوار"},TK[1]);chk("customer books doctor",st==200,b);oid=b[0]["out_order_id"]
for n in (2,3,6,7,8,1):
    chk(f"user{n} ({P[n]['kind'] if n in P else ('staff' if n==2 else 'customer')}) cannot set doctor appointment status",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"confirmed"},TK[n])[0]>=400)
chk("other roles cannot read the appointment",all(get("orders?select=id&id=eq."+oid,n)==[] for n in (3,6,7,8)))
chk("doctor reads it",len(get("orders?select=id&id=eq."+oid,5))==1)
chk("doctor confirms",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"confirmed"},TK[5])[0]==204)
# --- education filter
iso=lambda h:(datetime.datetime.utcnow()+datetime.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")
A=dict(p_title="درس أحياء (تجريبي)",p_subject="أحياء",p_starts=iso(40),p_minutes=60,p_mode="online",p_seats=3,p_price=80)
for n in (5,7,8,3,1):
    chk(f"user{n} cannot create a session",rpc("teacher_create_session",A,TK[n])[0]>=400)
st,sid=rpc("teacher_create_session",A,TK[6]);chk("teacher creates session",st==200,sid)
ss=get("tutor_sessions?select=id,teacher_id&status=eq.open",1);tid={P[6]["id"]}
chk("student-visible sessions all belong to teacher-kind providers",ss and {x["teacher_id"] for x in ss}<= {p["id"] for p in prov.values() if p["kind"]=="teacher"},len(ss))
chk("teacher cannot enroll in own session",rpc("enroll_in_session",{"p_session":sid},TK[6])[0]>=400)
for n in (5,7):
    st,b=rpc("enroll_in_session",{"p_session":sid},TK[n]);chk(f"user{n} (provider-role account) can enroll as a student: purchasing is not a role matter",st==200 and "53400" not in str(b),(st,str(b)[:60]))
for n in (5,7):
    chk(f"user{n} cannot cancel the teacher's session",rpc("teacher_cancel_session",{"p_session":sid},TK[n])[0]>=400)
chk("non-student merchant cannot read enrollments of teacher session",get("session_enrollments?select=id&session_id=eq."+sid,8)==[])
# --- store isolation
mkt=get("products?select=id,merchant_id,name&merchant_id=eq."+P[7]["id"],1);rst=get("products?select=id,merchant_id,name&merchant_id=eq."+P[8]["id"],1)
chk("both merchants have products visible to customers",len(mkt)>=2 and len(rst)==2)
st,b=rpc("place_product_order",{"p_product":rst[0]["id"],"p_qty":1,"p_address":"عنوان اختبار 5"},TK[1]);chk("customer orders from restaurant merchant",st==200,b);o8=b[0]["out_order_id"]
chk("grocery merchant cannot see restaurant order",get("orders?select=id&id=eq."+o8,7)==[])
chk("restaurant merchant sees it",len(get("orders?select=id&id=eq."+o8,8))==1)
chk("doctor/teacher/technician cannot see it",all(get("orders?select=id&id=eq."+o8,n)==[] for n in (3,5,6)))
chk("staff confirms",rpc("staff_set_order_status_v2",{"p_order":o8,"p_to":"confirmed"},TK[2])[0] in (200,204))
for n in (7,5,6,3):
    chk(f"user{n} cannot start the restaurant order",rpc("provider_set_order_status_v2",{"p_order":o8,"p_to":"in_progress"},TK[n])[0]>=400)
chk("restaurant merchant starts it",rpc("provider_set_order_status_v2",{"p_order":o8,"p_to":"in_progress"},TK[8])[0]==204)
pid0=mkt[0]["id"];before=get("products?select=price_egp&id=eq."+str(pid0),1)[0]["price_egp"]
r=call("/rest/v1/products?id=eq."+str(pid0),{"price_egp":1},TK[8],method="PATCH");after=get("products?select=price_egp&id=eq."+str(pid0),1)[0]["price_egp"]
chk("restaurant merchant cannot edit grocery product (price unchanged)",after==before,(r[0],before,after))
r=call("/rest/v1/products",{"merchant_id":P[5]["id"],"name":"x","price_egp":1,"stock":1},TK[5]);chk("doctor cannot insert products",r[0]>=400,r)
# suspected gap: product owned by a non-merchant provider
own3=get("products?select=id,merchant_id&merchant_id=eq."+P[3]["id"],1)
if own3:
    st,b=rpc("place_product_order",{"p_product":own3[0]["id"],"p_qty":1,"p_address":"عنوان اختبار 5"},TK[1])
    print("INFO place_product_order on product owned by a technician-kind provider ->",st,"(200 means the RPC does not check merchant kind)")
else: print("INFO no product owned by a non-merchant provider is visible to customers")
print(sum(R),"pass",len(R)-sum(R),"fail")
