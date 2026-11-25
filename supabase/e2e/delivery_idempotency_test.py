# Precondition: consents exist for user 1; test provider kind=courier (set via SQL editor, reverted after).
import os,threading
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
c,s,p=login("1"),login("2"),login("3")
R=[];PID=os.environ["WASLA_TEST_PROVIDER_ID"]
def chk(n,ok,d=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+d[:150])
args={"p_pickup":"شارع 1 (اختبار)","p_dropoff":"شارع 2 (اختبار)","p_what":"طرد اختبار تكرار"}
r=rpc("place_delivery_request",args,c);chk("place",r[0]==200,str(r));rid=r[1]
# concurrent double assign: exactly one succeeds
res=[]
def go(): res.append(rpc("assign_delivery",{"p_request":rid,"p_courier":PID},s)[0])
t=[threading.Thread(target=go) for _ in range(4)];[x.start() for x in t];[x.join() for x in t]
chk("4 concurrent assigns: exactly one succeeds",res.count(204)==1,str(res))
chk("repeat assign refused",rpc("assign_delivery",{"p_request":rid,"p_courier":PID},s)[0]>=400)
res=[]
def go2(): res.append(rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"picked_up"},p)[0])
t=[threading.Thread(target=go2) for _ in range(4)];[x.start() for x in t];[x.join() for x in t]
chk("4 concurrent pickups: exactly one succeeds",res.count(204)==1,str(res))
chk("repeat pickup refused",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"picked_up"},p)[0]>=400)
chk("delivered once",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"delivered"},p)[0]==204)
chk("repeat delivered refused",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"delivered"},p)[0]>=400)
chk("no move out of delivered",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"picked_up"},p)[0]>=400)
chk("cancel delivered refused",rpc("customer_cancel_delivery",{"p_request":rid},c)[0]>=400)
chk("assign delivered refused",rpc("assign_delivery",{"p_request":rid,"p_courier":PID},s)[0]>=400)
r=rpc("place_delivery_request",args,c);rid2=r[1]
chk("cancel new ok",rpc("customer_cancel_delivery",{"p_request":rid2},c)[0]==204)
chk("repeat cancel refused",rpc("customer_cancel_delivery",{"p_request":rid2},c)[0]>=400)
chk("assign cancelled refused",rpc("assign_delivery",{"p_request":rid2,"p_courier":PID},s)[0]>=400)
chk("invalid status value refused",rpc("courier_set_delivery_status",{"p_request":rid2,"p_to":"new"},p)[0]>=400)
chk("bogus request id refused",rpc("courier_set_delivery_status",{"p_request":"00000000-0000-0000-0000-000000000000","p_to":"picked_up"},p)[0]>=400)
print(sum(R),"pass",len(R)-sum(R),"fail")
