# Precondition: user 5 owns a doctor provider (approved, active, with schedules). PID is discovered, WASLA_TEST_PROVIDER_ID is optional and must match.
import os,threading,datetime
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
c,s,d=login("1"),login("2"),login("5")
R=[]
_dp=[x for x in call("/rest/v1/providers?select=id,kind,user_id&kind=eq.doctor&user_id=not.is.null",None,s)[1] if x["user_id"]==call("/auth/v1/user",None,d)[1]["id"]]
assert len(_dp)==1,("fixture: user 5 must own exactly one doctor provider",_dp)
PID=_dp[0]["id"]
assert os.environ.get("WASLA_TEST_PROVIDER_ID",PID)==PID,"WASLA_TEST_PROVIDER_ID does not match user 5 doctor provider"
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:160])
# earlier runs consume slots, so pick a day that still has full capacity (exactly 4 slots) instead of a fixed offset; print which day was used
day=None
for _k in range(2,60):
    _d=(datetime.datetime.utcnow()+datetime.timedelta(days=_k)).strftime("%Y-%m-%d")
    _st,_sl=rpc("clinic_available_slots",{"p_provider":PID,"p_day":_d},c)
    assert _st==200,("fixture: slots lookup failed",_st,str(_sl)[:80])
    if len(_sl)==4: day=_d;break
assert day,"fixture: no full-capacity day in the next 60 days"
print("using day",day)
st,slots=rpc("clinic_available_slots",{"p_provider":PID,"p_day":day},c)
chk("customer sees slots for doctor",st==200 and len(slots)>=4,f"{st} n={len(slots) if isinstance(slots,list) else slots}")
slot=slots[0]["slot"] if isinstance(slots,list) and slots else None
st,b=rpc("book_clinic_slot",{"p_provider":PID,"p_at":slot,"p_notes":"حجز اختبار"},c);chk("book slot",st==200,b)
oid=b[0]["out_order_id"] if st==200 else None
st,slots2=rpc("clinic_available_slots",{"p_provider":PID,"p_day":day},c)
chk("booked slot disappears",all(x["slot"]!=slot for x in slots2))
chk("double booking same slot refused",rpc("book_clinic_slot",{"p_provider":PID,"p_at":slot},c)[0]>=400)
chk("non-slot time refused",rpc("book_clinic_slot",{"p_provider":PID,"p_at":day+"T10:07:00+02:00"},c)[0]>=400)
# concurrent booking of the same free slot by 4 threads
slot2=slots2[0]["slot"];res=[]
def go():res.append(rpc("book_clinic_slot",{"p_provider":PID,"p_at":slot2},c)[0])
t=[threading.Thread(target=go) for _ in range(4)];[x.start() for x in t];[x.join() for x in t]
chk("4 concurrent bookings of one slot: exactly one succeeds",res.count(200)==1,res)
# doctor workflow
chk("customer cannot set appointment status",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"confirmed"},c)[0]>=400)
chk("staff (not the doctor) cannot set status",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"confirmed"},s)[0]>=400)
chk("doctor cannot skip to done",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"done"},d)[0]>=400)
chk("doctor confirms",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"confirmed"},d)[0]==204)
chk("repeat confirm refused",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"confirmed"},d)[0]>=400)
chk("doctor starts",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"in_progress"},d)[0]==204)
chk("doctor completes",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"done"},d)[0]==204)
chk("no change after done",rpc("doctor_set_appointment_status",{"p_order":oid,"p_to":"cancelled"},d)[0]>=400)
sl=call("/rest/v1/orders?select=id,status,scheduled_at,sector&id=eq."+str(oid),None,d)[1]
chk("doctor sees own appointment",isinstance(sl,list) and len(sl)==1 and sl[0]["status"]=="done",sl)
# customer cancel frees slot
res2=rpc("book_clinic_slot",{"p_provider":PID,"p_at":slot2},c)
oid2=None
if res2[0]==200: oid2=res2[1][0]["out_order_id"]
else:
    mine=call("/rest/v1/orders?select=id&scheduled_at=eq."+slot2.replace("+","%2B")+"&sector=eq.clinic&status=eq.new",None,c)[1];oid2=mine[0]["id"] if mine else None
chk("have second appointment",oid2 is not None)
chk("customer cancels new appointment",rpc("customer_cancel_order_v2",{"p_order":oid2},c)[0] in (200,204))
st,slots3=rpc("clinic_available_slots",{"p_provider":PID,"p_day":day},c)
chk("cancelled slot is bookable again",any(x["slot"]==slot2 for x in slots3))
print(sum(R),"pass",len(R)-sum(R),"fail")
