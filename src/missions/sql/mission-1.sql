-- Executed as ONE batch on the DB_DATABASE connection (no USE / GO).
-- RestDB runs at compatibility level 100, where TRY_CONVERT does not exist.
-- All data changes run in a single transaction: any error rolls everything back.
SET NOCOUNT ON;

DECLARE @LastBak NVARCHAR(50);
DECLARE @LastBakDate DATETIME;

SELECT TOP 1 @LastBak = Last_Bak_Date
FROM js_config;

BEGIN TRY
    SET @LastBakDate = CONVERT(DATETIME, @LastBak, 103);
END TRY
BEGIN CATCH
    SET @LastBakDate = NULL;
END CATCH;

print @LastBakDate; print @LastBak; PRINT (format(getdate(),'yyyy/MM/dd hh:mm:ss tt','en-US'));
IF @LastBakDate IS NULL
BEGIN
    PRINT N'⚠️ تاريخ النسخة الاحتياطية غير صالح';
	THROW 50002, N'تم إيقاف التنفيذ: مرّ أكثر من يوم على آخر نسخة احتياطية', 1;
END
ELSE IF CAST(@LastBakDate AS DATE) = CAST(GETDATE() AS DATE)
BEGIN
    PRINT N'✅ آخر نسخة احتياطية تمت اليوم';
END
ELSE
BEGIN
    PRINT N'❌ آخر نسخة احتياطية ليست اليوم';
	THROW 50002, N'تم إيقاف التنفيذ: مرّ أكثر من يوم على آخر نسخة احتياطية', 1;
END

SET XACT_ABORT ON;

BEGIN TRY
BEGIN TRANSACTION;

truncate table JS_Anlz_Requirment_Details ;
truncate table JS_Anlz_Requirment_MST ;
truncate table JS_Anlz_Requirment_Products ;
truncate table JS_Anlz_Requirment_TEMP ;

truncate table JS_CompactCreate_Details ;
truncate table JS_CompactCreate_Master ;
truncate table JS_CompactCreate_Mny ;
truncate table JS_CompactCreate_SubDetails ;

truncate table JS_DailyStore ;
--truncate table JS_DeliveringREQ ;
-- delete  from JS_DeliveringREQ
truncate table JS_History ;
truncate table JS_Insurance_Mov ;
truncate table JS_Males_Bill ;

truncate table JS_MalesCashTrans ;
truncate table JS_MaterialMov ;
truncate table JS_Ohda ;
truncate table JS_OhdaDetails ;
truncate table JS_ProductDamage ;

truncate table JS_ProductDiscount ;
truncate table JS_ProductMov ;
truncate table JS_RET_Bills_Details ;
truncate table JS_RET_Bills_Master ;
truncate table JS_ReturnSupply_Details ;
truncate table JS_ReturnSupply_Master ;

truncate table JS_SalesOrder_Details ;
truncate table JS_SalesOrder_Master ;
truncate table JS_SectionStoreMove ;
truncate table JS_Supply_Details ;
truncate table JS_Supply_Master ;
truncate table JS_TableMov ;
truncate table JS_Trans ;
truncate table JS_TransDetails ;
truncate table js_trans_Info ;

truncate table JS_RET_Bills_Details ;
truncate table JS_RET_Bills_Master ;
truncate table JS_ReturnSupply_Details ;
truncate table JS_ReturnSupply_Master ;
truncate table JS_Journals;
truncate table JS_CatchReceipts;
truncate table JS_Bills_Details ;
delete from JS_Bills_Master ;
delete from JS_Bills_Master_Return ;
DBCC CHECKIDENT ('JS_Bills_Master', RESEED, 0);

delete from JS_Bills_Prodec_Cansl;
delete from JS_HST_BILL_DTL;
delete from JS_HST_BILL_MST;
delete from JS_HST_RETBILL_MST;
DBCC CHECKIDENT ('JS_HST_BILL_MST', RESEED, 0);
delete from Js_Stockaking_dtl;
delete from Js_Stockaking_Mst;

delete from JS_Sheft_Trans_dtl;
delete from JS_Sheft_Trans_Mst;
delete from JS_Seft;

delete from JS_Group_Bill_dtl;
delete from JS_Grop_Bills;

delete from JS_Bills_Details_Rqwset;
delete from JS_Bills_Master_Rqwset;


update  JS_Products set Qty=0 ;
update  JS_Materials set Qty=0 ;
DECLARE @linkwithTaxSA INT;
SELECT TOP 1 @linkwithTaxSA = isnull(linkwithTaxSA,0) FROM js_config;
IF @linkwithTaxSA = 0
BEGIN
    UPDATE JS_Machines
    SET BillIndex = 1,
        RetBillIndex = 1;
END

update  JS_Tables set TB_State =0;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
