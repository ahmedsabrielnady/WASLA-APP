import os,sys
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
c,s,p=login("1"),login("2"),login("3")   # customer, admin/staff, courier (provider id from WASLA_TEST_PROVIDER_ID, kind=courier)
PID=os.environ["WASLA_TEST_PROVIDER_ID"]
R=[]
def chk(n,ok,d=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+d)
r=rpc("place_delivery_request",{"p_pickup":"محل البقالة، شبين القناطر","p_dropoff":"شارع الجمهورية 5 (اختبار)","p_what":"علبة اختبار"},c)
chk("customer places delivery",r[0]==200,str(r)[:90]); d=r[1] if r[0]==200 else None
rec_=call("/rest/v1/delivery_requests?select=status,customer_fee_egp",None,c)[1];print(rec_)
chk("fee is zero for the customer",bool(rec_) and rec_[0]["customer_fee_egp"]==0)
_v=call("/rest/v1/delivery_requests?select=id,courier_id",None,p)[1]  # a courier may keep seeing requests assigned to it earlier; it must never see an unassigned one
chk("provider/courier cannot see unassigned",isinstance(_v,list) and d not in [x["id"] for x in _v] and all(x["courier_id"]==PID for x in _v),str(len(_v)))
chk("anon cannot place",rpc("place_delivery_request",{"p_pickup":"abcd","p_dropoff":"abcd","p_what":"ab"},None)[0]>=400)
chk("customer cannot assign",rpc("assign_delivery",{"p_request":d,"p_courier":PID},c)[0]==403 or rpc("assign_delivery",{"p_request":d,"p_courier":PID},c)[0]>=400)
chk("courier cannot pick up unassigned",rpc("courier_set_delivery_status",{"p_request":d,"p_to":"picked_up"},p)[0]>=400)
chk("staff assigns",rpc("assign_delivery",{"p_request":d,"p_courier":PID},s)[0]==204)
chk("customer cannot cancel after assign",rpc("customer_cancel_delivery",{"p_request":d},c)[0]>=400)
chk("courier cannot skip to delivered",rpc("courier_set_delivery_status",{"p_request":d,"p_to":"delivered"},p)[0]>=400)
chk("courier picked_up",rpc("courier_set_delivery_status",{"p_request":d,"p_to":"picked_up"},p)[0]==204)
chk("courier delivered",rpc("courier_set_delivery_status",{"p_request":d,"p_to":"delivered"},p)[0]==204)
chk("customer sees delivered",call("/rest/v1/delivery_requests?select=status&id=eq."+d,None,c)[1]==[{"status":"delivered"}])
r2=rpc("place_delivery_request",{"p_pickup":"محل آخر شبين","p_dropoff":"شارع الجمهورية 6 (اختبار)","p_what":"طرد اختبار"},c)
chk("second delivery + customer cancel before assign",r2[0]==200 and rpc("customer_cancel_delivery",{"p_request":r2[1]},c)[0]==204)
print(sum(R),"pass",len(R)-sum(R),"fail")
