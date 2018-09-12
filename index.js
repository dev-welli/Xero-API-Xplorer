'use strict';

const express = require('express');
const session = require('express-session');
const XeroClient = require('xero-node').AccountingAPIClient;;
const exphbs = require('express-handlebars');

//let beautify = require("json-beautify")

var app = express();

var exbhbsEngine = exphbs.create({
    defaultLayout: 'main',
    layoutsDir: __dirname + '/views/layouts',
    partialsDir: [
        __dirname + '/views/partials/'
    ],
    helpers: {
        beautiful: function (beautify) {
            //console.log(beautify)
            return JSON.stringify(beautify)
        }
    }
});

app.engine('handlebars', exbhbsEngine.engine);

app.set('view engine', 'handlebars');
app.set('views', __dirname + '/views');

app.use(express.logger());
app.use(express.bodyParser());

app.set('trust proxy', 1);
app.use(session({
    secret: 'something crazy',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false
    }
}));

app.use(express.static(__dirname + '/assets'));

function getXeroClient(session) {
    let config = {};
    try {
        config = require('./config/config.json');
    } catch (ex) {
        if (process && process.env && process.env.APPTYPE) {
            //no config file found, so check the process.env.
            config.appType = process.env.APPTYPE.toLowerCase();
            config.callbackUrl = process.env.authorizeCallbackUrl;
            config.consumerKey = process.env.consumerKey;
            config.consumerSecret = process.env.consumerSecret;
        } else {
            throw "Config not found";
        }
    }

    return new XeroClient(config, session);
}

async function authorizeRedirect(req, res, returnTo) {
    var xeroClient = getXeroClient(req.session);
    let requestToken = await xeroClient.oauth1Client.getRequestToken();

    var authoriseUrl = xeroClient.oauth1Client.buildAuthoriseUrl(requestToken);
    req.session.oauthRequestToken = requestToken;
    req.session.returnTo = returnTo;
    res.redirect(authoriseUrl);
}

function authorizedOperation(req, res, returnTo, callback) {
    if (req.session.accessToken) {
        callback(getXeroClient(req.session.accessToken));
    } else {
        authorizeRedirect(req, res, returnTo);
    }
}

function handleErr(err, req, res, returnTo) {
    //console.log("A", err);
    if (err.data && err.data.oauth_problem && err.data.oauth_problem == "token_rejected") {
        authorizeRedirect(req, res, returnTo);
    } else {
        res.redirect('error', err);
    }
}

app.get('/error', function (req, res) {
    //console.log("B", req.query.error);
    res.render('index', {
        error: req.query.error
    });
})

// Home Page
app.get('/', function (req, res) {
    //res.redirect('/invoicesRAW')
    res.render('index', {
        active: {
            overview: true
        }
    });
});

// Redirected from xero with oauth results
app.get('/access', async function (req, res) {
    var xeroClient = getXeroClient();

    let savedRequestToken = req.session.oauthRequestToken;
    let oauth_verifier = req.query.oauth_verifier;
    let accessToken = await xeroClient.oauth1Client.swapRequestTokenforAccessToken(savedRequestToken, oauth_verifier);

    req.session.accessToken = accessToken;

    var returnTo = req.session.returnTo;
    res.redirect(returnTo || '/');
});

app.get('/organisations', async function (req, res) {
    authorizedOperation(req, res, '/organisations', async function (xeroClient) {
        try {
            let organisations = await xeroClient.organisations.get()
            res.render('organisations', {
                organisations: organisations.Organisations,
                active: {
                    organisations: true,
                    nav: {
                        accounting: true
                    }
                }
            })
        } catch (err) {
            handleErr(err, req, res, 'organisations');
        }

    })
});

//Will only work with Contacts & Invoices endpoints for now. Deleting the rest

//Contacts endpoint

app.get('/contactsRAW', async function (req, res) {
    authorizedOperation(req, res, '/contactsRAW', function (xeroClient) {
        //console.log(req.body);

        xeroClient.contacts.get({

            })
            .then(function (result) {

                res.render('contactsRAW', {
                    contacts: result,
                    active: {
                        contacts: true,
                        nav: {
                            accounting: true
                        }
                    }
                });
            })
            .catch(function (err) {
                handleErr(err, req, res, 'contactsRAW');
            })

    })
});

app.get('/createcontact', async function (req, res) {
    return res.render('createcontact', {

    });
});

app.post('/createcontact', async function (req, res) {
    try {
        authorizedOperation(req, res, '/createcontact', async function (xeroClient) {
            var contact = await xeroClient.contacts.create(

                {
                    Name: req.body.Name
                }

            ).then((data) => {
                res.redirect('contacts')
            })
        })

    } catch (err) {
        res.render('createcontact', {
            outcome: 'Error',
            err: err
        })
    }
})

//Invoices endpoint


app.post('/filter', async function (req, res) {
    //res.send("hello")
    authorizedOperation(req, res, '/invoicesRAW', function (xeroClient) {

        let request = req.body.explicitQueryStatus
        let request2 = req.body.explicitQueryContactIds


        let filter = {};

        if (req.body.explicitQueryContactIds) {
            filter.ContactID = req.body.explicitQueryContactIds
        }

        if (req.body.explicitQueryStatus) {
            filter.Status = req.body.explicitQueryStatus
        }


        console.log("FORM BODY")
        console.info(req.body);
        //console.log("STATUSES" + request.status);

        // TODO: Right now the form result will create the below object but I need to remove 
        // if the field is not filled (empty string). Also need to think how to combine them with & instead of commas
        //  { InvoiceID: '134',
        //   'modified-after': '',
        //   InvoiceNumbers: '575',
        //   IDs: '45764',
        //   Statuses: 'DRAFT',
        //   ContactIDs: '687',
        //   where: 'Contact.Name="Welli"',
        //   page: '1' }

        xeroClient.invoices.get(filter).then(function (result) {

                let invoices = result.Invoices
                let rawInvoices = invoices.map(invoice => JSON.stringify(invoice, null, 4))

                res.render('invoicesRAW', {
                    invoices: rawInvoices,
                    active: {
                        invoices: true,
                        nav: {
                            accounting: true
                        }
                    }
                });
            })
            .catch(function (err) {
                handleErr(err, req, res, 'invoicesRAW');
            })

    })
})

app.get('/invoicesRAW', async function (req, res) {
    authorizedOperation(req, res, '/invoicesRAW', function (xeroClient) {
        console.log(req.body);

        //let filter = req.body.status
        //let filter = req.body.explicitQueryContactIds

        xeroClient.invoices.get({
                //Statuses: filter
                //ContactIDs: filter

            })
            .then(function (result) {

                //console.log("CCCCC", JSON.stringify(result, null, 2));

                res.render('invoicesRAW', {
                    invoices: result,
                    active: {
                        invoices: true,
                        nav: {
                            accounting: true
                        }
                    }
                });
            })
            .catch(function (err) {
                handleErr(err, req, res, 'invoicesRAW');
            })

    })
});




app.get('/createinvoiceRAW', async function (req, res) {
    return res.render('createinvoiceRAW', {});
});

app.post('/createinvoiceRAW', async function (req, res) {
    try {
        authorizedOperation(req, res, '/createinvoiceRAW', async function (xeroClient) {
            console.dir(req.body);
            console.log("form content");
            //console.dir(req.body);
            console.log("--------------------------------------------------------");


            var invoice = await xeroClient.invoices.create(

                {
                    Type: "ACCREC",
                    Contact: {
                        Name: "Jem The Cat"
                    },
                    Date: "2018-09-01",
                    DueDate: "2018-09-02",
                    LineItems: [{
                        Description: "Consulting services as agreed (20% off standard rate)",
                        Quantity: "10",
                        UnitAmount: "100.00",
                        AccountCode: "200"
                    }],
                    Status: "SUBMITTED"
                }

            )
            console.log(invoice)
            res.redirect('invoices')
        })


    } catch (err) {
        res.render('createinvoiceRAW', {
            outcome: 'Error',
            err: err
        })
    }
})


//=================================

app.use(function (req, res, next) {
    if (req.session)
        delete req.session.returnto;
})

var PORT = process.env.PORT || 3000;

app.listen(PORT);
console.log("listening on http://localhost:" + PORT);