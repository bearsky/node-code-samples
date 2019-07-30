const csv = require('csvtojson');
const uuid4 = require('uuid4');
const { Controller } = require('./base');
const { serviceFactory } = require('../services/index');
const { SETTINGS } = require('../config/config');
const { errorFactory, ERRORS } = require('../common/errors');
const { employeesImportPreprocessService } = require('../services/employees-import-preprocess.service');

class EmployeeFromCsv extends Controller {
  async importFromCsv(req, res) {
    const service = this.getService(req);
    await service.destroy();
    const draftEmployeeService = serviceFactory(req, 'employeesdraft');

    try {
      const jsonObj = await csv().fromFile(req.file.path);
      const draftEmployeeCounter = (await draftEmployeeService.findAll()).length;
      if (draftEmployeeCounter + jsonObj.length > SETTINGS.EMPLOYEE_DRAFT_MAX_AMOUNT) {
        throw errorFactory(ERRORS.E400_4_draft_employee_limit_exceed,
          `Maximum amount (${SETTINGS.EMPLOYEE_DRAFT_MAX_AMOUNT}) of employees in draft exceed!`);
      }

      const promises = jsonObj.map(InputRow => service.create({ InputRow }));
      await Promise.all(promises);

      res.status(200).end();
    } catch (e) {
      if (e instanceof TypeError) {
        throw errorFactory(ERRORS.E400_3_no_file_detected);
      }
      throw e;
    }
  }

  async toDraftEmplyoee(req, res) {
    try {
      const service = this.getService(req);
      const records = await service.findAll();
      const serializer = req.body.dict;
      const fileName = req.body.fileName;
      const draftEmployeeService = serviceFactory(req, 'employeesdraft');
      const importHash = uuid4();

      await employeesImportPreprocessService.preprocessCsvRecords(records, serializer, req.sympleteDB);

      const promises = records.map((record) => {
        const rawRow = {
          CompanyID: req.user.CompanyID,
          ImportFileName: fileName,
          ImportedBy: req.user.EmployeeID,
          ImportHash: importHash,
          ImportColumnsCount: Object.keys(serializer).length,
          ImportRecordsCount: records.length
        };
        Object.entries(serializer)
          .forEach((entry) => {
            rawRow[entry[1]] = record.InputRow[entry[0]];
          });
        return draftEmployeeService.create(rawRow);
      });
      const result = await Promise.all(promises);
      await service.destroy();
      res.json({ msg: `${result.length} draft employees has been created` });
    } catch (e) {
      throw e;
    }
  }

  async isAnyDraft(req, res) {
    const draftEmployeeService = serviceFactory(req, 'employeesdraft');
    const draftEmployee = await draftEmployeeService.findOne({ Imported: false });

    res.status(200).json({ isAnyDraft: !!draftEmployee });
  }

  async clearDrafts(req, res) {
    await req.sympleteDB.employeesdraft.destroy({
      where: {
        Imported: false
      }
    });

    res.status(200).json({ msg: 'Success' });
  }
}
const employeesFromCsvController = new EmployeeFromCsv('employeesfromcsv');

module.exports = employeesFromCsvController;

