# Push subscription opt-in storage (draft 3000). wasla-test only, synthetic endpoints on an allowed origin (https://fcm.googleapis.com/fcm/send/<run>-<i>), never contacted. Draft 3000 + 3100. Nothing is ever sent.
import os,uuid
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
T={n:login(str(n)) for n in (1,2,9)}
R=[]
def chk(n,ok,x=""):R.append(bool(ok));print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
code=lambda r:(r[1].get("code") if isinstance(r[1],dict) else None)
run=uuid.uuid4().hex[:8]
EP=lambda i:f"https://fcm.googleapis.com/fcm/send/synthetic-{run}-{i}"
PK=("B"+"x"*30,"a"*16)
mine=[]
sub=lambda t,ep,k=PK:rpc("push_subscribe",{"p_endpoint":ep,"p_p256dh":k[0],"p_auth":k[1]},t)
cnt=lambda t:rpc("push_my_device_count",{},t)
try:
    b1=cnt(T[1])[1];b9=cnt(T[9])[1];chk("baseline counts are integers",isinstance(b1,int) and isinstance(b9,int),(b1,b9))
    r=rpc("push_subscribe",{"p_endpoint":EP(0),"p_p256dh":PK[0],"p_auth":PK[1]},None);chk("anon subscribe refused (401/403)",r[0] in(401,403),r[0])
    r=rpc("push_my_device_count",{},None);chk("anon count refused (401/403)",r[0] in(401,403),r[0])
    for who in (1,2):
        r=call("/rest/v1/push_subscriptions?select=*",None,T[who]);chk(f"user {who} direct select refused (42501)",r[0] in(401,403) and code(r)=="42501",(r[0],code(r)))
        r=call("/rest/v1/push_subscriptions",{"user_id":"00000000-0000-4000-8000-000000000000","endpoint":EP(1),"p256dh":PK[0],"auth":PK[1]},T[who],"POST");chk(f"user {who} direct insert refused",r[0] in(401,403),r[0])
    r=call("/rest/v1/push_subscriptions?select=*",None,None);chk("anon direct select refused",r[0] in(401,403),r[0])
    r=sub(T[9],"http://fcm.googleapis.com/fcm/send/x");chk("http endpoint refused (22023)",r[0]==400 and code(r)=="22023",(r[0],code(r)))
    r=sub(T[9],EP(2),("short","a"*16));chk("short p256dh refused (22023)",r[0]==400 and code(r)=="22023",(r[0],code(r)))
    r=sub(T[9],EP(3),(PK[0],"tiny"));chk("short auth refused (22023)",r[0]==400 and code(r)=="22023",(r[0],code(r)))
    r=sub(T[9],"https://fcm.googleapis.com/fcm/send/"+"x"*700);chk("endpoint over 600 chars refused (22023)",r[0]==400 and code(r)=="22023",(r[0],code(r)))
    chk("refused calls stored nothing",cnt(T[9])[1]==b9,cnt(T[9])[1])
    r=sub(T[9],EP(10));mine.append(EP(10));chk("positive control: valid subscribe by user 9",r[0] in(200,204),(r[0],str(r[1])[:60]))
    chk("user 9 count +1",cnt(T[9])[1]==b9+1,cnt(T[9])[1])
    r=sub(T[9],EP(10));chk("same endpoint again is idempotent",r[0] in(200,204) and cnt(T[9])[1]==b9+1,(r[0],cnt(T[9])[1]))
    chk("user 1 count unchanged (own rows only)",cnt(T[1])[1]==b1,cnt(T[1])[1])
    r=rpc("push_unsubscribe",{"p_endpoint":EP(10)},T[1]);chk("user 1 cannot remove user 9's endpoint (returns 0)",r[0]==200 and r[1]==0 and cnt(T[9])[1]==b9+1,(r[0],r[1]))
    r=sub(T[1],EP(10));chk("hijack: user 1 subscribing user 9's endpoint is refused (42501)",r[0]>=400 and code(r)=="42501",(r[0],code(r)))
    chk("hijack: nothing moved, user 9 still owns it",cnt(T[9])[1]==b9+1 and cnt(T[1])[1]==b1,(cnt(T[1])[1],cnt(T[9])[1]))
    r=rpc("push_unsubscribe",{"p_endpoint":EP(10)},T[9]);chk("owner unsubscribes (returns 1)",r[0]==200 and r[1]==1 and cnt(T[9])[1]==b9,(r[0],r[1]))
    r=sub(T[1],EP(10));mine.append(EP(10));chk("after the owner unsubscribed, user 1 can register it",r[0] in(200,204) and cnt(T[1])[1]==b1+1,(r[0],cnt(T[1])[1]))
    bad=["https://fcm.googleapis.com.evil.example/fcm/send/a","https://evilfcm.googleapis.com/fcm/send/a","https://fcm.googleapis.com@evil.example/x","https://evil.example@fcm.googleapis.com/x","https://fcm.googleapis.com:8443/fcm/send/a","https://FCM.googleapis.com/fcm/send/a","https://fcm%2egoogleapis.com/fcm/send/a","https://fcm.googleapis.com/fcm/send/../../x","https://fcm.googleapis.com/fcm/send/%2e%2e/x","https://fcm.googleapis.com/fcm/send/a%40b","https://fcm.googleapis.com/fcm/send/a?u=https://evil.example","https://fcm.googleapis.com/fcm/send/a#x","https://fcm.googleapis.com","https://evil.push.apple.com.evil.example/a","https://a.b.push.apple.com/a","https://push.apple.com/a","https://notpush.apple.com/a","https://127.0.0.1/a","https://169.254.169.254/latest","https://localhost/a","https://[::1]/a","https://wns2-db5p.notify.windows.com/w/x","https://fcm.googleapis.com\\@evil.example/a","https://fcm.googleapis.com/a b","https://updates.push.services.mozilla.com.evil.example/wpush/v1/a","https://example.com/a"]
    for u in bad:
        r=sub(T[9],u);chk("deceptive/disallowed endpoint refused (22023): "+u[:70],r[0]==400 and code(r)=="22023",(r[0],code(r)))
    chk("none of the refused endpoints was stored",cnt(T[9])[1]==b9,cnt(T[9])[1])
    for u in ["https://updates.push.services.mozilla.com/wpush/v1/synthetic-"+run,"https://web.push.apple.com/synthetic"+run]:
        r=sub(T[9],u);mine.append(u);chk("allowed origin accepted: "+u[:60],r[0] in(200,204),(r[0],code(r)))
    for u in mine[-2:]:rpc("push_unsubscribe",{"p_endpoint":u},T[9])
    chk("allowed-origin rows removed",cnt(T[9])[1]==b9,cnt(T[9])[1])
    r=rpc("push_unsubscribe",{"p_endpoint":EP(10)},T[1]);chk("user 1 unsubscribes (returns 1)",r[0]==200 and r[1]==1 and cnt(T[1])[1]==b1,(r[0],r[1]))
    r=rpc("push_unsubscribe",{"p_endpoint":EP(10)},T[1]);chk("second unsubscribe returns 0",r[0]==200 and r[1]==0,(r[0],r[1]))
    room=5-b1
    for i in range(20,20+room):
        r=sub(T[1],EP(i));mine.append(EP(i));assert r[0] in(200,204),("fixture: subscribe failed",i,r[0],str(r[1])[:60])
    chk("user 1 is at the 5 device cap",cnt(T[1])[1]==5,cnt(T[1])[1])
    r=sub(T[1],EP(99));chk("6th device refused (54000)",r[0]>=400 and code(r)=="54000",(r[0],code(r)))
    r=sub(T[1],EP(20));chk("re-subscribing an existing device at the cap still works",r[0] in(200,204),(r[0],code(r)))
finally:
    for ep in set(mine):
        for who in (1,9):rpc("push_unsubscribe",{"p_endpoint":ep},T[who])
    print("cleanup counts",cnt(T[1])[1],cnt(T[9])[1])
print("DONE",sum(R),"pass",len(R)-sum(R),"fail")
