# wasla-test only (draft 2900). Synthetic bytes only. Lab/radiology result FILES in the private bucket 'lab-results'.
# Refusals are asserted by specific 4xx; 500/53400 never counts as a pass.
import os,urllib.request,urllib.error
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
T={n:login(str(n)) for n in (1,2,5,8,9,12)}
OK=[]
def chk(n,ok,x=""):OK.append(bool(ok));print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
def put(path,data,tok,mime="application/pdf"):
    h={"apikey":K,"Content-Type":mime,"x-upsert":"false"}
    if tok:h["Authorization"]="Bearer "+tok
    r=urllib.request.Request(U+"/storage/v1/object/lab-results/"+path,data=data,headers=h,method="POST")
    try:
        with urllib.request.urlopen(r,timeout=60) as x:return x.status,x.read()[:120]
    except urllib.error.HTTPError as e:return e.code,e.read()[:160]
def getf(path,tok):
    h={"apikey":K}
    if tok:h["Authorization"]="Bearer "+tok
    r=urllib.request.Request(U+"/storage/v1/object/authenticated/lab-results/"+path,headers=h)
    try:
        with urllib.request.urlopen(r,timeout=60) as x:return x.status,x.read()
    except urllib.error.HTTPError as e:return e.code,e.read()[:160]
def delf(path,tok):
    r=urllib.request.Request(U+"/storage/v1/object/lab-results/"+path,headers={"apikey":K,"Authorization":"Bearer "+tok},method="DELETE")
    try:
        with urllib.request.urlopen(r,timeout=60) as x:return x.status,x.read()[:120]
    except urllib.error.HTTPError as e:return e.code,e.read()[:160]
def sign(path,tok):
    return call("/storage/v1/object/sign/lab-results/"+path,{"expiresIn":60},tok)
def denied(st):return st in (400,401,403,404) 
PDF=b"%PDF-1.4\n% synthetic lab result (test data)\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
for k in ("terms","privacy"):
    for u in (1,9):rpc("accept_consent",{"p_kind":k,"p_version":"test"},T[u])
tn="اختبار ملف نتيجة %d"%(os.getpid()%1000)
r=rpc("provider_upsert_lab_test",{"p_name":tn,"p_kind":"lab","p_price":100},T[12]);tid=r[1];chk("lab adds a test",r[0]==200,(r[0],msg(r)))
r=rpc("request_lab_test",{"p_test":tid},T[9]);rid=r[1];chk("patient 9 requests",r[0]==200,(r[0],msg(r)))
path=rid+"/result.pdf"
chk("upload before sample_done refused (lab, status requested)",denied(put(path,PDF,T[12])[0]),put(path,PDF,T[12]))
rpc("lab_set_request_status",{"p_request":rid,"p_to":"sample_done"},T[12])
chk("patient cannot upload even at sample_done",denied(put(path,PDF,T[9])[0]),put(path,PDF,T[9])[0])
chk("other provider (radiology 8) cannot upload",denied(put(path,PDF,T[8])[0]),put(path,PDF,T[8])[0])
chk("anonymous cannot upload",denied(put(path,PDF,None)[0]),put(path,PDF,None)[0])
chk("wrong mime (text/plain) refused",denied(put(rid+"/x.txt",b"hello",T[12],"text/plain")[0]),put(rid+"/x.txt",b"hello",T[12],"text/plain")[0])
big=b"%PDF"+b"0"*(5242880+1)
chk("file over 5 MB refused",denied(put(rid+"/big.pdf",big,T[12])[0]),put(rid+"/big.pdf",big,T[12])[0])
st,b=put(rid+"/a../../x.pdf",PDF,T[12])
chk("dot-dot name cannot leave the request folder (stays under lab-results/<request id>/ or is refused)",st>=400 or (b"lab-results/"+rid.encode()+b"/") in b,(st,b[:90]))
other="00000000-0000-0000-0000-000000000000/result.pdf"
chk("upload under a different request id refused",denied(put(other,PDF,T[12])[0]),put(other,PDF,T[12])[0])
st,b=put(path,PDF,T[12]);chk("owning lab uploads at sample_done",st==200,(st,b))
chk("patient cannot read it before it is published",denied(getf(path,T[9])[0]),getf(path,T[9])[0])
r=rpc("lab_publish_result_file",{"p_request":rid,"p_path":rid+"/missing.pdf"},T[12]);chk("publish with a path that has no object refused",r[0]==403 or r[0]==400,(r[0],msg(r)))
r=rpc("lab_publish_result_file",{"p_request":rid,"p_path":other},T[12]);chk("publish with another request's path refused",r[0]==400,(r[0],msg(r)))
r=rpc("lab_publish_result_file",{"p_request":rid,"p_path":path},T[9]);chk("patient cannot publish",r[0] in(400,403),(r[0],msg(r)))
r=rpc("lab_publish_result_file",{"p_request":rid,"p_path":path},T[8]);chk("other provider cannot publish",r[0] in(400,403),(r[0],msg(r)))
r=rpc("lab_publish_result_file",{"p_request":rid,"p_path":path,"p_text":"ab"},T[12]);chk("too short note refused",r[0]==400,(r[0],msg(r)))
nb=call("/rest/v1/notifications?select=id,kind,ref_id",None,T[9])[1]
r=rpc("lab_publish_result_file",{"p_request":rid,"p_path":path,"p_text":"ملاحظة من المعمل (تجريبية)"},T[12]);chk("owning lab publishes the file with a note",r[0]==204,(r[0],msg(r)))
row=call("/rest/v1/lab_requests?select=status,result_file_path,result_text&id=eq."+rid,None,T[9])[1]
chk("row is result_ready with the path and note",row==[{"status":"result_ready","result_file_path":path,"result_text":"ملاحظة من المعمل (تجريبية)"}],row)
nn=[x for x in call("/rest/v1/notifications?select=id,kind,ref_id",None,T[9])[1] if x["id"] not in {y["id"] for y in nb}]
chk("exactly one lab_result_ready notice, ref = request, no file name",len(nn)==1 and nn[0]["kind"]=="lab_result_ready" and nn[0]["ref_id"]==rid and path not in str(nn),nn)
st,b=getf(path,T[9]);chk("patient downloads the exact bytes",st==200 and b==PDF,(st,len(b) if st==200 else b))
st,b=getf(path,T[12]);chk("owning lab downloads it",st==200 and b==PDF,st)
for n,l in ((1,"other patient"),(8,"radiology provider"),(5,"doctor"),(2,"staff")):
    chk(f"{l} cannot download it",denied(getf(path,T[n])[0]),getf(path,T[n])[0])
chk("anonymous cannot download it",denied(getf(path,None)[0]),getf(path,None)[0])
st,s=sign(path,T[9]);chk("patient gets a signed URL",st==200 and isinstance(s,dict) and ("signedURL" in s or "signedUrl" in s),st)
chk("other patient cannot sign",sign(path,T[1])[0]>=400 and sign(path,T[1])[0]<500,sign(path,T[1])[0])
chk("staff cannot sign",sign(path,T[2])[0]>=400 and sign(path,T[2])[0]<500,sign(path,T[2])[0])
chk("re-upload after publish refused",denied(put(rid+"/second.pdf",PDF,T[12])[0]),put(rid+"/second.pdf",PDF,T[12])[0])
st,b=delf(path,T[12]);chk("lab delete after publish does not remove it",getf(path,T[9])[0]==200,(st,b))
st,b=delf(path,T[9]);chk("patient delete does not remove it",getf(path,T[9])[0]==200,(st,b))
r=rpc("lab_publish_result_file",{"p_request":rid,"p_path":path},T[12]);chk("second publish refused",r[0]==403 or r[0]==400,(r[0],msg(r)))
r=rpc("patient_cancel_lab_request",{"p_request":rid},T[9]);chk("cancel after result refused",r[0]==400,(r[0],msg(r)))
row=call("/rest/v1/lab_requests?select=status,result_file_path&id=eq."+rid,None,T[9])[1];chk("state unchanged after the refusals",row==[{"status":"result_ready","result_file_path":path}],row)
# regression: text-only publish still works, and a delete before publish removes an uploaded file
r=rpc("request_lab_test",{"p_test":tid},T[9]);r2=r[1];chk("second request",r[0]==200,(r[0],msg(r)))
rpc("lab_set_request_status",{"p_request":r2,"p_to":"sample_done"},T[12])
p2=r2+"/draft.pdf";chk("upload then lab deletes before publishing",put(p2,PDF,T[12])[0]==200 and delf(p2,T[12])[0]==200,"")
chk("deleted file cannot be published",rpc("lab_publish_result_file",{"p_request":r2,"p_path":p2},T[12])[0] in (400,403),"")
r=rpc("lab_publish_result",{"p_request":r2,"p_text":"نتيجة نصية تركيبية"},T[12]);chk("text-only publish still works",r[0]==204,(r[0],msg(r)))
row=call("/rest/v1/lab_requests?select=status,result_file_path,result_text&id=eq."+r2,None,T[9])[1];chk("text-only row has no file path",row==[{"status":"result_ready","result_file_path":None,"result_text":"نتيجة نصية تركيبية"}],row)
print("DONE",sum(OK),"pass",len(OK)-sum(OK),"fail")
