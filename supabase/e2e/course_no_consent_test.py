# No-consent enrollment refusal with a fresh consent-less fixture user (01000000009, customer, created via dashboard Add user). wasla-test only.
import os
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
T9=login("9");T6=login("6")
R=[]
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
chk("fixture precondition: user 9 has no consents",call("/rest/v1/consents?select=kind",None,T9)[1]==[])
cs=call("/rest/v1/courses?select=id,seats&active=eq.true",None,T9)[1]
# Fresh fixture course: the first active course where user 9 has no enrollment row at all (earlier journeys leave booked rows, which would turn the positive control into 'already enrolled').
cid=None
for _c in cs:
    if call("/rest/v1/course_enrollments?select=id&course_id=eq."+_c["id"],None,T9)[1]==[]:cid=_c["id"];break
chk("fixture precondition: a course exists where user 9 has no enrollment row",cid is not None,len(cs))
if cid is None:print("DONE",sum(R),"pass",len(R)-sum(R),"fail");raise SystemExit(1)
print("course",cid)
def enrolled():return call("/rest/v1/course_enrollments?select=id,status&course_id=eq."+cid,None,T9)[1]
st,b=rpc("enroll_in_course",{"p_course":cid},T9)
chk("no consent: enrollment refused by the consent check (403, 42501, not 53400)",st==403 and b.get("code")=="42501" and "consent" in b.get("message",""),(st,b.get("code"),b.get("message")))
chk("no consent: no enrollment row was created",enrolled()==[],enrolled())
V=os.environ.get("WASLA_POLICY_VERSION","draft-2026-11-24.2")
st,b=rpc("accept_consent",{"p_kind":"terms","p_version":V},T9);chk("accept terms only",st in(200,204),(st,str(b)[:60]))
st,b=rpc("enroll_in_course",{"p_course":cid},T9)
chk("terms only: still refused (privacy missing, 42501)",st==403 and b.get("code")=="42501",(st,b.get("code"),b.get("message")))
chk("terms only: no enrollment row",enrolled()==[])
st,b=rpc("accept_consent",{"p_kind":"privacy","p_version":V},T9);chk("accept privacy",st in(200,204),(st,str(b)[:60]))
st,b=rpc("enroll_in_course",{"p_course":cid},T9);chk("positive control: with both consents the same call succeeds",st==200,(st,str(b)[:70]))
chk("enrollment row now booked",[e["status"] for e in enrolled()]==["booked"],enrolled())
eid=enrolled()[0]["id"];st,b=rpc("cancel_course_enrollment",{"p_enrollment":eid},T9);chk("cancel works (cleanup)",st in(200,204),(st,str(b)[:50]))
print("DONE",sum(R),"pass",len(R)-sum(R),"fail")
