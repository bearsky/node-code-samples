/**
 * In this method we get all articles by subcategory.
 * To find it we must to have productID and categoryID
 * We can find archived articles if param "arhived" will be equals "1"
 * When product in empty or equal "0" we find articles in all products.
 * Function "mergeArticleAndEmployees" using to build array with article and collaborators assigned to this article
 * @type {*|(function(): articles)}
 */

const mergeArticleAndEmployees = require('../helperFunction/mergeArticleAndEmployees');
const sortArticles = require('../helperFunction/sortArticles');

module.exports = async (req, res) => {
  try {
    const db = req.dbConnection;
    const {
      prodId = '0',
      catId,
      arhived = '0',
      subcatId,
      // If we have no limit we set limit as 1 billion rows
      limit = '1000000000',
      offset = '0'
    } = req.query;
    const {EmployeeID} = req.user;

    let getBasicInfo = '';
    if (subcatId !== 'null' && subcatId !== null && subcatId) {
      getBasicInfo = `CALL KB_getArticlesBySubcatId(${EmployeeID}, ${prodId}, ${subcatId}, ${catId}, ${arhived}, ${limit}, ${offset})`;
    } else {
      getBasicInfo = `CALL KB_getArticlesWithoutSubcatByCatID(${EmployeeID}, ${prodId}, ${catId}, ${arhived}, ${limit}, ${offset})`;
    }
    // SQL string to find distinct collaborators by articles ID
    let getCollaborators = `SELECT DISTINCT e.EmployeeID, e.Name, e.Surname, e.avatar, e.Role, e.UserRole, e2a.article_id
FROM employees e
       LEFT OUTER JOIN kb_employee_to_article e2a ON e.EmployeeID = e2a.employee_id
WHERE e2a.article_id IN (`;

    if (+subcatId <= 0 && subcatId) throw new Error('Missing or bad subcategory ID in URL');
    if (!catId || +catId <= 0) throw new Error('Missing or bad category ID in URL');

    console.log(getBasicInfo);
    const getArticleInfo = new Promise((resolve, reject) => {
      db.query(getBasicInfo, (err, basicInfo) => {
        err ? reject({message: err.sqlMessage}) : resolve(basicInfo)
      });
    });

    const [info] = await getArticleInfo;

    if (!info.length) {
      res.json([])
    } else {

      info.forEach(art => {
        getCollaborators += `${art.id}, `
      });

      // remove " ," and add ");" to valid query
      getCollaborators = getCollaborators.slice(0, -2) + ');';

      // Method to find collaborators.
      const getArticleCollaborators = new Promise((resolve, reject) => {
        db.query(getCollaborators, (err, employees) => {
          err ? reject({message: err.sqlMessage}) : resolve(employees)
        });
      });

      const employees = await getArticleCollaborators;
      let articles = mergeArticleAndEmployees(info, employees);
      articles = sortArticles(articles);
      res.json(articles)
    }
  } catch (e) {
    res.status(400).json({msg: e.message});
  }
};

