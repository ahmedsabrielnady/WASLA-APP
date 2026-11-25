# wasla-test only. Audited read authorization (draft 0800). Requires an uploaded file: creates its own request.
import os,json,base64,urllib.request,urllib.error
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
BASE=os.environ["WASLA_TEST_URL"];KEY=os.environ["WASLA_TEST_PUBLISHABLE_KEY"]
TK={n:login(str(n)) for n in (1,2,5,7,8)}
R=[]
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:140])
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
def up(path):
    rq=urllib.request.Request(BASE+"/storage/v1/object/prescriptions/"+path,data=PNG,method="POST",headers={"apikey":KEY,"Authorization":"Bearer "+TK[1],"Content-Type":"image/png"});return urllib.request.urlopen(rq).status
st,rid=rpc("submit_prescription_request",{"p_note":"روشتة تجريبية للتدقيق (بيانات تجريبية)"},TK[1]);path=rid+"/a.png";up(path)
_me=call("/rest/v1/profiles?select=id&limit=1",None,TK[7])[1][0]["id"];P7=[x["id"] for x in call("/rest/v1/providers?select=id,user_id&specialty=eq.pharmacy",None,TK[7])[1] if x["user_id"]==_me][0]  # actor under test is user 7; list_pharmacies order is not stable
rpc("rx_set_audience",{"p_request":rid,"p_pharmacies":[P7],"p_consent":True},TK[1])
def auth(n,p=path):return rpc("rx_authorize_read",{"p_name":p},TK[n])
for n,l,exp in ((1,"owner",True),(7,"selected pharmacy",True),(2,"staff",True),(8,"radiology",False),(5,"doctor",False)):
    st,b=auth(n);chk(f"{l} authorize_read -> {exp}",st==200 and b is exp,(st,b))
st,b=auth(1,"../etc/passwd");chk("bad path -> false",st==200 and b is False,b)
st,b=call("/rest/v1/rpc/rx_authorize_read",{"p_name":path},None);chk("anonymous refused",st>=400 and "53400" not in str(b),st)
st,b=call("/rest/v1/rx_access_log?select=id",None,TK[1]);chk("users cannot read the audit log",st>=400 or b==[],(st,str(b)[:40]))
st,b=rpc("rx_retention_candidates",{},TK[2]);chk("staff/users cannot call retention candidates",st>=400 and "53400" not in str(b),(st,str(b)[:40]))
rpc("customer_close_prescription_request",{"p_request":rid},TK[1])
print("DONE",sum(R),"pass",len(R)-sum(R),"fail",flush=True)
