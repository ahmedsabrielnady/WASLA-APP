# Run only inside the SQL bracket in quote_assigned_fixture.sql (ON, run this with the order id, ALWAYS OFF). Last run 3 pass 0 fail, each refusal 42501.
# Precondition (set by a DB owner in the test SQL editor, impossible via app RPCs): the order is status 'quoted' AND assigned to the test provider.
import sys
src=open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
c,s,p=login("1"),login("2"),login("3")
o=sys.argv[1]
def row():return call("/rest/v1/orders?select=status,price_egp,provider_id&id=eq."+o,None,c)[1][0]
print("precondition",row())
R=[]
def chk(n,r):
    ok=r[0]>=400;R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(r)[:170])
chk("assigned provider start on quoted refused",rpc("provider_set_order_status_v2",{"p_order":o,"p_to":"in_progress"},p))
chk("assigned provider done on quoted refused",rpc("provider_set_order_status_v2",{"p_order":o,"p_to":"done"},p))
chk("staff in_progress on quoted refused",rpc("staff_set_order_status_v2",{"p_order":o,"p_to":"in_progress"},s))
print("after",row());print(sum(R),"pass",len(R)-sum(R),"fail")
