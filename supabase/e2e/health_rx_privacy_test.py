# wasla-test only, synthetic 1x1 PNG. usage: health_rx_privacy_test.py [phase1|phase2 <request_id>]
# Access checks need a real 4xx; a 500/53400 rate-limit never counts as a pass.
import os,sys,json,base64,urllib.request,urllib.error
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
BASE=os.environ["WASLA_TEST_URL"];KEY=os.environ["WASLA_TEST_PUBLISHABLE_KEY"]
TK={n:login(str(n)) for n in (1,2,3,5,6,7,8)}
R=[]
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:140])
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
def sto(method,path,tok,data=None,ct=None):
    h={"apikey":KEY}
    if tok:h["Authorization"]="Bearer "+tok
    if ct:h["Content-Type"]=ct
    rq=urllib.request.Request(BASE+"/storage/v1/"+path,data=data,method=method,headers=h)
    try:
        r=urllib.request.urlopen(rq);return r.status,r.read()
    except urllib.error.HTTPError as e:return e.code,e.read()
def denied(n,st,b):chk(n,st in(400,401,403,404) and b"53400" not in b,(st,b[:60]))
if len(sys.argv)<2 or sys.argv[1]=="phase1":
    st,rid=rpc("submit_prescription_request",{"p_note":"روشتة تجريبية للخصوصية (بيانات تجريبية)"},TK[1]);chk("submit",st==200,rid)
    path=rid+"/rx.png"
    st,ph=rpc("list_pharmacies",{},TK[1]);PH=[x["id"] for x in ph]
    _me=call("/rest/v1/profiles?select=id&limit=1",None,TK[7])[1][0]["id"];P7=[x["id"] for x in call("/rest/v1/providers?select=id,user_id&specialty=eq.pharmacy",None,TK[7])[1] if x["user_id"]==_me][0]  # actor under test is user 7; list_pharmacies order is not stable
    st,b=rpc("rx_set_audience",{"p_request":rid,"p_pharmacies":[P7],"p_consent":True},TK[1]);chk("patient selects pharmacy",st in(200,204),(st,b))
    st,b=sto("POST","object/prescriptions/"+path,TK[1],PNG,"image/png");chk("owner uploads png",st==200,(st,b[:60]))
    denied("other user cannot upload into the request folder",*sto("POST","object/prescriptions/"+rid+"/evil.png",TK[5],PNG,"image/png"))
    denied("upload into a random folder refused",*sto("POST","object/prescriptions/00000000-0000-4000-8000-000000000000/x.png",TK[1],PNG,"image/png"))
    denied("html upload refused",*sto("POST","object/prescriptions/"+rid+"/x.html",TK[1],b"<script>1</script>","text/html"))
    denied("anonymous upload refused",*sto("POST","object/prescriptions/"+rid+"/anon.png",None,PNG,"image/png"))
    st,b=rpc("attach_prescription_file",{"p_request":rid,"p_path":path},TK[1]);chk("owner attaches file",st in(200,204),(st,b))
    for p in ("/rest/v1/rpc/attach_prescription_file",):
        s2,b2=call(p,{"p_request":rid,"p_path":path},TK[5]);chk("other user cannot attach to someone's request",s2>=400 and "53400" not in str(b2),(s2,str(b2)[:60]))
    s2,b2=rpc("attach_prescription_file",{"p_request":rid,"p_path":"00000000-0000-4000-8000-000000000000/rx.png"},TK[1]);chk("path of another request refused",s2>=400,(s2,str(b2)[:50]))
    denied("public URL does not serve the file",*sto("GET","object/public/prescriptions/"+path,None))
    denied("anonymous authenticated-URL refused",*sto("GET","object/authenticated/prescriptions/"+path,None))
    st,b=sto("GET","object/authenticated/prescriptions/"+path,TK[1]);chk("owner reads own file",st==200 and b==PNG,(st,len(b)))
    st,b=sto("GET","object/authenticated/prescriptions/"+path,TK[7]);chk("approved pharmacy reads file while open",st==200 and b==PNG,(st,len(b)))
    for n,l in ((8,"radiology"),(5,"doctor"),(6,"teacher"),(3,"technician"),(2,"staff-not-customer? (staff can read)")):
        st,b=sto("GET","object/authenticated/prescriptions/"+path,TK[n])
        if n==2:chk("staff can read (documented)",st==200,st)
        else:denied(f"{l} cannot read the file",st,b)
    rows=call("/rest/v1/prescription_requests?select=attachment_path&id=eq."+rid,None,TK[8])[1];chk("radiology cannot see the request row",rows==[],rows)
    for bad in ({"p_request":rid,"p_price":50,"p_eta":1},{"p_request":rid,"p_price":50,"p_eta":99999}):
        s2,b2=rpc("pharmacy_quote_request",bad,TK[7]);chk("bad eta refused",s2>=400 and "53400" not in str(b2),(s2,str(b2)[:50]))
    st,q=rpc("pharmacy_quote_request",{"p_request":rid,"p_price":70,"p_note":"متوفر (تجريبي)","p_delivery":True,"p_eta":45},TK[7]);chk("pharmacy answers with price + delivery 45 min",st==200,q)
    qs=call("/rest/v1/prescription_quotes?select=price_egp,delivery_available,eta_minutes&request_id=eq."+rid,None,TK[1])[1]
    chk("customer sees price, delivery and eta",qs==[{"price_egp":70,"delivery_available":True,"eta_minutes":45}],qs)
    st,b=sto("GET","object/authenticated/prescriptions/"+path,TK[7]);chk("quoting pharmacy still reads file after answered",st==200,st)
    chk("pharmacy still sees answered request",len(call("/rest/v1/prescription_requests?select=id&id=eq."+rid,None,TK[7])[1])==1)
    open("/tmp/rx_rid","w").write(rid)
    print("RID",rid)
else:
    rid=open("/tmp/rx_rid").read().strip();path=rid+"/rx.png";mode=sys.argv[2]
    if mode=="revoked":
        denied("revoked pharmacy cannot read file",*sto("GET","object/authenticated/prescriptions/"+path,TK[7]))
        chk("revoked pharmacy cannot see request",call("/rest/v1/prescription_requests?select=id&id=eq."+rid,None,TK[7])[1]==[])
        s2,b2=rpc("pharmacy_quote_request",{"p_request":rid,"p_price":60},TK[7]);chk("revoked pharmacy cannot quote",s2>=400 and "53400" not in str(b2),(s2,str(b2)[:50]))
        chk("owner still reads file",sto("GET","object/authenticated/prescriptions/"+path,TK[1])[0]==200)
    if mode=="close":
        chk("owner closes",rpc("customer_close_prescription_request",{"p_request":rid},TK[1])[0] in(200,204))
        denied("pharmacy loses file access after close",*sto("GET","object/authenticated/prescriptions/"+path,TK[7]))
        chk("pharmacy loses request row after close",call("/rest/v1/prescription_requests?select=id&id=eq."+rid,None,TK[7])[1]==[])
        s2,b2=rpc("pharmacy_quote_request",{"p_request":rid,"p_price":60},TK[7]);chk("quote on closed refused",s2>=400 and "53400" not in str(b2),(s2,str(b2)[:50]))
        denied("owner cannot upload more to a closed request",*sto("POST","object/prescriptions/"+rid+"/late.png",TK[1],PNG,"image/png"))
        chk("owner still reads own file (history)",sto("GET","object/authenticated/prescriptions/"+path,TK[1])[0]==200)
print("DONE",sum(R),"pass",len(R)-sum(R),"fail")
